import { managementBeRequest } from './backend-api.js'

/**
 * RA-317 — reaching the `withdrawn` state the way it actually happens now.
 *
 * "Withdraw" is an OPERATOR action. RA-317 removes the case-management
 * withdraw affordance (and its confirmation interstitial) from the regulator
 * UI, so the Case Management service-driven withdraw journey the suite used to seed `withdrawn`
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
 * knowledge about a screen, so it lives in `support/`, and is made as the
 * operator's service through `backend-api.js`. It is for case-management-only
 * items (`work-item-api.js`); an item the operator journey backend owns is
 * withdrawn through that backend (`withdrawOperatorApplication` in
 * `operator-backend-api.js`), so the two stay consistent.
 */

/**
 * Withdraw a re-accreditation work item as the operator.
 *
 * `reason` becomes the withdrawal note the backend records before
 * transitioning, and feeds the "Withdrawn" GOV.UK Notify email's
 * `withdrawal_notes` personalisation (RA-204). Although `Reason` is nullable
 * on the DTO (`WithdrawApplicationRequest(string? Reason)`), it is mandatory
 * at runtime: `ReAccreditationWithdrawValidator` rejects a blank/whitespace
 * reason with a 400 "Enter a reason for the withdrawal", so callers must pass
 * a non-empty reason.
 *
 * Returns `{ status, body }` so guard callers can assert on the raw outcome
 * (e.g. a refusal from the wrong state), rather than throwing. Callers that
 * want a hard failure on anything other than 200 should use
 * `withdrawAsOperatorOrThrow`.
 */
export function withdrawAsOperator(workItemId, reason) {
  return managementBeRequest(
    'POST',
    `/work-items/re-accreditation/${workItemId}/withdraw`,
    { body: { reason } }
  )
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
