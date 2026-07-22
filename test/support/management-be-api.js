/**
 * RA-311/MGT-4 — direct calls into management-be's
 * `resume-from-query` endpoint.
 *
 * In production this endpoint is called service-to-service by the operator
 * backend once an operator resubmits a queried application (RA-311 OBE-2).
 * management-fe has no UI for it at all — RA-311 keeps the CM frontend out
 * of scope entirely — so there is no page object route to drive it through.
 * The query-*raise* side, by contrast, has a real UI (see query.page.js) and
 * should be driven through that, not through this module.
 *
 * Calls are made from the Node test process (plain `fetch`), not from
 * inside the browser session: management-be runs a deny-all CORS policy
 * (see Program.cs `ConfigureCors`), so a browser-side fetch from the
 * management-fe origin is blocked by the browser itself regardless of
 * docker networking. Calling from Node sidesteps CORS entirely — it is a
 * browser-only restriction — rather than loosening that policy for tests.
 * compose.yml publishes management-be's port for this; MANAGEMENT_BE_URL
 * lets it be overridden (mirrors BASE_URL/CHROMEDRIVER_URL elsewhere).
 *
 * Auth: this stack runs ASPNETCORE_ENVIRONMENT=Development with no
 * AUTH_SHARED_SECRET configured (see docker/config/management-be.env), so
 * CognitoClientIdAuthenticationHandler falls back to header-trust mode — a
 * bare x-cdp-cognito-client-id/-user-id/-user-name/-user-roles header set is
 * sufficient and no HMAC signature is required. `case-worker` is the role
 * WorkItemTenancy/WorkItemEndpoints checks for read/mutate access to any
 * tenant's work item.
 */
const MANAGEMENT_BE_URL =
  process.env.MANAGEMENT_BE_URL || 'http://localhost:8085'

export const MGT4_TEST_USER_ID = 'mgt-4-e2e-user'
export const MGT4_TEST_USER_NAME = 'MGT-4 E2E Test User'

const TRUST_HEADERS = {
  'x-cdp-cognito-client-id': 'mgt-4-e2e-tests',
  'x-cdp-user-id': MGT4_TEST_USER_ID,
  'x-cdp-user-name': MGT4_TEST_USER_NAME,
  'x-cdp-user-roles': 'case-worker'
}

/**
 * POST `path` against management-be and return `{ status, body }`, parsing
 * the body as JSON when present.
 */
async function postJson(path, payload) {
  const response = await fetch(`${MANAGEMENT_BE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...TRUST_HEADERS },
    body: JSON.stringify(payload)
  })
  const text = await response.text()
  let body = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  return { status: response.status, body }
}

/**
 * POST /work-items/re-accreditation/{id}/resume-from-query
 *
 * `sections` is opaque per RA-311 §3/§6 — the operator backend's own
 * section schemas, not modelled here — so callers pass whatever JSON-
 * serialisable value each section key should carry.
 */
export function resumeFromQuery(
  workItemId,
  { responderContactDetails, sectionKeys, sections, fileReferences }
) {
  return postJson(
    `/work-items/re-accreditation/${workItemId}/resume-from-query`,
    {
      responderContactDetails,
      sectionKeys,
      sections,
      fileReferences
    }
  )
}
