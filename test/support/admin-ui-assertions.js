import { expect } from '@wdio/globals'

import { getWorkItem } from './decision-api.js'

/**
 * RA-751, RA-752. Assertions on management-be's answers to the Admin UI, its
 * read-only caller, shared by the specs that play it.
 */

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
 * Assert management-be refuses the Admin UI's write (`send`) as forbidden,
 * and that the work item reads the same afterwards as before.
 */
export async function expectRefusedAndUnchanged(workItemId, send) {
  const before = writableView(await getWorkItem(workItemId))
  expectForbidden(await send())
  expect(writableView(await getWorkItem(workItemId))).toEqual(before)
}
