import { expect } from '@wdio/globals'

import {
  CASEWORKER_USER,
  adminUiRequest,
  expectStatus,
  isAdminUiCallerEnabled,
  managementBeRequest
} from './backend-api.js'
import { getWorkItem } from './decision-api.js'

/**
 * RA-751, RA-752. Helpers for the specs that play the Admin UI, management-be's
 * read-only caller (see backend-api.js).
 */

/**
 * `describe` the Admin UI block `title` where the run may play the Admin UI,
 * and skip it elsewhere: on CDP, where the secret is the Admin UI's alone, and
 * on any stack that does not enable it (the monorepo root's compose.yml runs
 * wdio.conf.js with ADMIN_UI_CALLER_ENABLED unset). A skip is said in the run
 * log, so a run that skipped the block cannot pass for one that ran it.
 */
export function describeIfAdminUi(title, fn) {
  if (isAdminUiCallerEnabled()) {
    return describe(title, fn)
  }
  // eslint-disable-next-line no-console -- say WHY the block is skipped in the run log
  console.warn(
    `ADMIN_UI_CALLER_ENABLED is not "true", so "${title}" is SKIPPED. Set it to "true" (and ADMIN_UI_SHARED_SECRET to management-be's AUTH_SHARED_SECRET__ADMIN_UI where that is set) to run it.`
  )
  return describe.skip(title, fn)
}

/** Assert management-be refused the Admin UI's request as forbidden. */
export function expectForbidden({ status, headers }) {
  expect(status).toBe(403)
  expect(headers.get('content-type')).toContain('application/problem+json')
}

/** The parts of a work item any write would change. */
const writableView = ({
  stateId,
  lastModifiedAt,
  assignedToId,
  payload,
  notes,
  auditLog
}) => ({ stateId, lastModifiedAt, assignedToId, payload, notes, auditLog })

/**
 * Assert that the read-only gate, and nothing else, refuses the Admin UI's
 * `method` `path` with `body` on the work item `workItemId`:
 *
 *   1. the Admin UI's request is a 403 ProblemDetails, and the work item
 *      reads the same afterwards as before;
 *   2. the very same request from this suite, a caller that is not
 *      read-only, acting as `user`, then answers `allowedStatus`.
 *
 * (2) is what makes (1) prove the gate: management-be accepts the request on
 * its own terms (the item's state, the body, the user's role and nation), so
 * the 403 is not a refusal every caller would get. The Admin UI's request
 * carries `user`'s role and nation when it has them, so a handler's own role
 * or nation check cannot be what refused it either. Returns the work item as
 * it reads after (2).
 */
export async function expectOnlyTheGateRefuses(
  workItemId,
  { method, path, body, user = CASEWORKER_USER, allowedStatus = 200 }
) {
  const before = writableView(await getWorkItem(workItemId))
  expectForbidden(
    await adminUiRequest(method, path, {
      body,
      role: user.role,
      nation: user.nation
    })
  )
  expect(writableView(await getWorkItem(workItemId))).toEqual(before)
  expectStatus(
    await managementBeRequest(method, path, { body, user }),
    allowedStatus,
    `${method} ${path} as ${user.id}, not read-only`
  )
  return getWorkItem(workItemId)
}
