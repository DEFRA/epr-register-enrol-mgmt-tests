import detail from '../page-objects/work-item-detail.page.js'
import query from '../page-objects/query.page.js'
import { startAssessment } from './re-accreditation-journey.js'
import { CASEWORKER_USER, managementBeRequest } from './backend-api.js'
import { SIMULATED_DELIVERED_EMAIL } from './operator-backend-api.js'

/**
 * RA-372 — driving the query → resubmission → continue-review lifecycle.
 *
 * Two of the three legs are ordinary browser journeys and stay in the page
 * objects. The middle leg is not: the `queried` → `updated` transition is
 * triggered by the OPERATOR backend calling
 * `POST /work-items/re-accreditation/{id}/resume-from-query` on
 * management-be. There is no case-management UI affordance for it (by
 * design — a caseworker cannot resubmit on the operator's behalf), so for a
 * case-management-only item (`work-item-api.js`) the suite makes that call
 * itself, as the operator's service, through `backend-api.js`. An item the
 * operator journey backend owns (`operator-backend-api.js`) must be
 * resubmitted through that backend instead, so the two stay consistent.
 *
 * These live in `support/` rather than a page object for the reason
 * `terminal-states.js` gives: they are journeys and service calls, not
 * knowledge about a screen.
 */

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
      email: SIMULATED_DELIVERED_EMAIL,
      role: 'Compliance Manager'
    }
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
  const result = await managementBeRequest(
    'POST',
    `/work-items/re-accreditation/${workItemId}/resume-from-query`,
    { body: resubmissionBody(sectionKeys, sections) }
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
  return managementBeRequest(
    'POST',
    `/work-items/re-accreditation/${workItemId}/continue-review`,
    { user: CASEWORKER_USER }
  )
}

/**
 * Drive a freshly created application to `duly-made`.
 *
 * RA-316 replaced the task-driven route (tick both `submitted` tasks, let
 * the backend hook auto-transition) with the explicit "Duly make" CTA and a
 * payment-date page. Both those tasks and the hook are deleted, so this
 * delegates to the one canonical implementation rather than keeping a
 * second copy of the flow in sync.
 */
export { dulyMake as driveToDulyMade } from './re-accreditation-journey.js'

/**
 * Drive a `duly-made` application on to `assessment-in-progress`.
 *
 * RA-410 removed the `confirm-registration-fee-paid` task and ungated the
 * transition, so this is now the "Assign to yourself and start" CTA and
 * nothing else. Delegates to the canonical implementation rather than
 * keeping a second copy of the flow in sync.
 *
 * The blue-tag assertion is retained on top of the state-id check
 * `startAssessment` already makes: `assessment-in-progress` and `updated`
 * share the display name "Updated" (RA-324) and the badge colour is the only
 * thing a regulator can see that tells them apart.
 */
export async function driveToAssessment(workItemId) {
  await startAssessment(workItemId)
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
