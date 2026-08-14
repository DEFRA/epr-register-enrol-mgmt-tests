import { MANAGEMENT_BE_URL } from './query-resubmission.js'

/**
 * RA-317 — reaching the `withdrawn` state the way it actually happens now.
 *
 * "Withdraw" is an OPERATOR action. RA-317 removes the case-management
 * withdraw affordance (and its confirmation interstitial) from the regulator
 * UI, so the CM-driven withdraw journey the suite used to seed `withdrawn`
 * with is gone. The honest way to reach the state from here is the same one a
 * real operator takes: management-be's operator withdraw endpoint.
 *
 *   POST /work-items/re-accreditation/{id}/withdraw   body { reason }
 *
 * The backend derives the correct transition for the item's current state
 * (`withdraw`, `withdraw-during-duly-made`, `withdraw-during-assessment`, …)
 * server-side and records the reason as a note before transitioning, so a
 * single call withdraws an item from ANY non-terminal state — callers do not
 * pick the transition.
 *
 * This mirrors `query-resubmission.js`: an operator-backend service call, not
 * knowledge about a screen, so it lives in `support/`. It reuses that file's
 * `MANAGEMENT_BE_URL` (the runner reaches the backend over its published host
 * port, NOT via `baseUrl`, which the browser resolves) and the same unsigned
 * CDP trust headers — the test stack configures no shared secret, so
 * `signRequestHeaders` is a no-op and unsigned calls are what the backend
 * expects.
 */

/**
 * The CDP trust headers management-be authenticates on, naming the acting
 * identity as the operator's service so the audit history attributes the
 * withdrawal correctly (a caseworker did not do this). Mirrors
 * `query-resubmission.js`'s `OPERATOR_HEADERS`.
 */
const OPERATOR_HEADERS = {
  'content-type': 'application/json',
  'x-cdp-client-id': 'epr-register-enrol-mgmt-tests',
  'x-cdp-user-id': 'operator-service',
  'x-cdp-user-name': 'Operator Service'
}

/**
 * Withdraw a re-accreditation work item as the operator.
 *
 * `reason` becomes the withdrawal note the backend records before
 * transitioning, and feeds the "Withdrawn" GOV.UK Notify email's
 * `withdrawal_notes` personalisation (RA-204). It is optional on the DTO
 * (`WithdrawApplicationRequest(string? Reason)`), so an omitted reason is
 * still a valid call — the note is simply blank.
 *
 * Returns `{ status, body }` so guard callers can assert on the raw outcome
 * (e.g. a refusal from the wrong state), rather than throwing. Callers that
 * want a hard failure on anything other than 200 should use
 * `withdrawAsOperatorOrThrow`.
 */
export async function withdrawAsOperator(workItemId, reason) {
  const res = await fetch(
    `${MANAGEMENT_BE_URL}/work-items/re-accreditation/${workItemId}/withdraw`,
    {
      method: 'POST',
      headers: OPERATOR_HEADERS,
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(15_000)
    }
  )
  // A work item envelope on success, ProblemDetails on failure, and no body
  // at all on a 401 from the auth handler — read defensively so a parse
  // failure never masks the status the caller needs to see.
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

/**
 * Withdraw as the operator, throwing on anything other than 200 so a spec
 * that seeds `withdrawn` fails at the fixture rather than several assertions
 * later against an item that never moved.
 */
export async function withdrawAsOperatorOrThrow(workItemId, reason) {
  const result = await withdrawAsOperator(workItemId, reason)
  if (result.status !== 200) {
    throw new Error(
      `operator withdraw for ${workItemId} returned ${result.status}: ` +
        JSON.stringify(result.body)
    )
  }
  return result
}
