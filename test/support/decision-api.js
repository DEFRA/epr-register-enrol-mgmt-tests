/**
 * RA-527. Reading a work item, and making a determination, straight against
 * management-be rather than through the UI.
 *
 * For the cases the UI can no longer reach: once an item is Granted or
 * Refused, management-fe offers no "Make determination" button, but the
 * endpoint still answers a repeat (a double submit, a client retry, a stale
 * tab). The rules are those on `main`:
 *
 *   - the SAME outcome on its own final state is a 200 idempotent replay
 *     (`x-idempotent-replay: true`) that changes nothing;
 *   - the OTHER outcome is a 409.
 *
 * Calls are made as the stub caseworker the UI logs in as, so anything they
 * did write would read the same in the history as a UI action.
 */

import {
  CASEWORKER_USER,
  expectStatus,
  managementBeRequest
} from './backend-api.js'

/**
 * The work item as management-be stores it: `stateId`, `payload`,
 * `lastModifiedAt` and the whole `auditLog` (newest first).
 */
export async function getWorkItem(workItemId) {
  return expectStatus(
    await managementBeRequest('GET', `/work-items/${workItemId}`, {
      user: CASEWORKER_USER
    }),
    200,
    `GET work item ${workItemId}`
  ).body
}

/**
 * `POST /work-items/re-accreditation/{id}/decision` with `outcome`
 * (`'approved'` or `'rejected'`, the backend's words). Returns the raw
 * `{ status, headers, body }`, because a 409 is an answer the caller asserts
 * on, not a fixture failure.
 */
export function postDecision(workItemId, outcome) {
  return managementBeRequest(
    'POST',
    `/work-items/re-accreditation/${workItemId}/decision`,
    { body: { outcome }, user: CASEWORKER_USER }
  )
}
