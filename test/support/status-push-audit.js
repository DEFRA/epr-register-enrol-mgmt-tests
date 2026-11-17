import { browser } from '@wdio/globals'
import { getWorkItem } from './decision-api.js'

/**
 * RA-495. A work item's status pushes to the operator journey, read from
 * management-be's audit log rather than the Application history page: every
 * `status-push*` entry (sent, skipped or failed), oldest first, with its
 * details (route, action and target state).
 *
 * `detail.waitForAuditEntryCount` is the UI equivalent, for a spec asserting
 * what the regulator sees.
 */
export async function statusPushes(workItemId) {
  const { auditLog } = await getWorkItem(workItemId)
  return auditLog
    .filter((entry) => entry.action.startsWith('status-push'))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
}

/**
 * Polls until the work item holds at least `count` status-push entries: the
 * post-commit push runs in the background, after the response.
 */
export async function waitForStatusPushes(workItemId, count) {
  let pushes = []
  await browser.waitUntil(
    async () => {
      pushes = await statusPushes(workItemId)
      return pushes.length >= count
    },
    {
      timeout: 15000,
      timeoutMsg: `Expected ${count} status push entries on ${workItemId}`
    }
  )
  return pushes
}
