import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import query from '../page-objects/query.page.js'

/**
 * RA-372 — driving the query → resubmission → continue-review lifecycle.
 *
 * Two of the three legs are ordinary browser journeys and stay in the page
 * objects. The middle leg is not: the `queried` → `updated` transition is
 * triggered by the OPERATOR backend calling
 * `POST /work-items/re-accreditation/{id}/resume-from-query` on
 * management-be. There is no case-management UI affordance for it (by
 * design — a caseworker cannot resubmit on the operator's behalf) and the
 * operator's own service is not part of this compose stack, so the only
 * honest way to reach `updated` from here is to make that call directly.
 *
 * These live in `support/` rather than a page object for the reason
 * `terminal-states.js` gives: they are journeys and service calls, not
 * knowledge about a screen.
 */

/**
 * Where management-be is reachable from the TEST RUNNER — which is a Node
 * process, not the browser.
 *
 * This is deliberately not `baseUrl`. `baseUrl` is resolved by the browser
 * inside the selenium container (hence the `epr-register-enrol-management-fe`
 * service name in wdio.github.conf.js); the runner itself is a host process
 * in every configuration, including the compose run, so it reaches the
 * backend over its published port. compose.yml publishes 8085 for exactly
 * this reason.
 */
export const MANAGEMENT_BE_URL =
  process.env.MANAGEMENT_BE_URL ?? 'http://localhost:8085'

/**
 * The CDP trust headers management-be authenticates on.
 *
 * `x-cdp-client-id` is what turns a 401 into a real request — the
 * auth handler returns NoResult without it. The user headers carry the
 * acting identity into the audit log, so they are named for what is
 * genuinely acting here: the operator's service, not a caseworker. Naming
 * them after a caseworker would put a false attribution in the history the
 * later assertions read.
 *
 * The BFF additionally HMAC-signs these headers when a shared secret is
 * configured; the test stack configures none (see
 * `docker/config/management-be.env`), and `signRequestHeaders` is a no-op in
 * that case, so unsigned calls are exactly what the backend expects here.
 */
const OPERATOR_HEADERS = {
  'content-type': 'application/json',
  'x-cdp-client-id': 'epr-register-enrol-mgmt-tests',
  'x-cdp-user-id': 'operator-service',
  'x-cdp-user-name': 'Operator Service'
}

/**
 * The operator's answer to a query.
 *
 * `sectionKeys` must be real query sections (the backend validates against
 * the same list the query page offers) and `responderContactDetails` must
 * carry all three of fullName/email/role, or the call is a 400. `sections`
 * and `fileReferences` are opaque to management-be — this build deliberately
 * does not validate resubmission completeness — so a minimal object is
 * enough and keeps the fixture honest about what is actually exercised.
 * Callers that need to prove specific resubmitted values surface on the case
 * management summary (RA-291 regression) pass `sections` explicitly; every
 * other caller relies on the `{}` default.
 *
 * `sections`, if supplied, must be keyed by the operator backend's
 * `OperatorSection` enum name — `BusinessPlan` / `Prns` / `SamplingPlan` —
 * NOT by the kebab-case `sectionKeys` values. That is what
 * `HttpCaseWorkingApiAdapter.BuildSectionsPayload` actually sends in real
 * traffic, and `ReAccreditationResumeService`'s canonical-field merge looks
 * the key up verbatim (`Dictionary<string, JsonElement>`, ordinal-cased) — a
 * kebab-case key here silently fails to merge, exactly the bug this
 * fixture's callers exist to catch.
 */
function resubmissionBody(sectionKeys, sections) {
  return {
    sectionKeys,
    sections,
    fileReferences: [],
    responderContactDetails: {
      fullName: 'Olivia Operator',
      email: 'olivia.operator@example.test',
      role: 'Compliance Manager'
    }
  }
}

async function postToBackend(path, body) {
  const res = await fetch(`${MANAGEMENT_BE_URL}${path}`, {
    method: 'POST',
    headers: OPERATOR_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  })
  // ProblemDetails on failure, a work item envelope on success. Read it
  // defensively: a 401 from the auth handler has no JSON body at all, and a
  // parse failure there would mask the status code the caller needs to see.
  let payload = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }
  return {
    status: res.status,
    idempotentReplay: res.headers.get('x-idempotent-replay') === 'true',
    body: payload
  }
}

/**
 * Simulate the operator resubmitting a queried application, moving it from
 * `queried` to `updated`.
 *
 * Throws on anything other than 200 so a spec that fails later fails for its
 * own reason rather than silently asserting against an item that never
 * moved.
 */
export async function resumeFromQuery(
  workItemId,
  { sectionKeys = ['business-plan'], sections = {} } = {}
) {
  const result = await postToBackend(
    `/work-items/re-accreditation/${workItemId}/resume-from-query`,
    resubmissionBody(sectionKeys, sections)
  )
  if (result.status !== 200) {
    throw new Error(
      `resume-from-query for ${workItemId} returned ${result.status}: ` +
        JSON.stringify(result.body)
    )
  }
  return result
}

/**
 * Call `continue-review` directly, without asserting the outcome.
 *
 * Used only by the guard specs, which are about the refusals the endpoint
 * itself ships — states it cannot be called from, unknown ids, missing
 * identity. The happy path goes through the UI affordance instead, because
 * that is what the AC is about.
 */
export function continueReviewViaApi(workItemId) {
  return postToBackend(
    `/work-items/re-accreditation/${workItemId}/continue-review`,
    undefined
  )
}

/**
 * Create a re-accreditation application, already open on its detail page.
 *
 * The postcode is a caller-supplied discriminator for the same reason
 * ra-291-query-application.e2e.js gives: ApplicationReferenceGenerator
 * derives the reference from postcode and material, and items sharing both
 * exhaust its collision-retry budget.
 */
export async function createApplication({ organisationName, postcode }) {
  await workItems.goto()
  const { id } = await workItems.createWorkItem({
    organisationName,
    siteAddressLine1: '1 Resubmission Row',
    siteAddressTown: 'London',
    siteAddressPostcode: postcode,
    material: 'plastic',
    tonnageBand: '0-500'
  })
  await workItems.openWorkItem(id)
  return id
}

/**
 * Drive a freshly created application to `duly-made` by completing both
 * `submitted` tasks — the transition is automatic (there is no caller-
 * invocable duly-make action), fired by the backend's duly-made hook on the
 * last submitted task.
 */
export async function driveToDulyMade(workItemId) {
  await workItems.openWorkItem(workItemId)
  await detail.gotoTasks()
  await detail.setTaskStatus('verify-organisation-details', 'Completed')
  await detail.setTaskStatus('confirm-application-completeness', 'Completed')
  await detail.gotoDetail()
  await detail.assertState('Duly made')
}

/**
 * Drive a `duly-made` application on to `assessment-in-progress`.
 *
 * `payment-received` requires all duly-made tasks complete, so the fee task
 * is completed first.
 */
export async function driveToAssessment(workItemId) {
  await workItems.openWorkItem(workItemId)
  await detail.gotoTasks()
  await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
  await detail.gotoDetail()
  await detail.triggerAction('payment-received')
  await detail.assertStateTagClass('govuk-tag--blue')
}

/**
 * Raise a query through the UI, leaving the application in `queried`.
 *
 * Goes through the query page rather than the API on purpose: the query is
 * the caseworker's own action and the affordance is part of what the
 * lifecycle spec is proving still works.
 */
export async function raiseQuery(
  workItemId,
  {
    sections = ['business-plan'],
    reason = 'Please resend the business plan.'
  } = {}
) {
  await query.gotoFor(workItemId)
  await query.selectSections(sections)
  await query.fillReason(reason)
  await query.submit()
  await query.waitForDetailUrl(workItemId)
  await detail.assertState('Queried')
}
