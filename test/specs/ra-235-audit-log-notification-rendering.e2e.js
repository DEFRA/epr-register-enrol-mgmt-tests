import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { withdrawAsOperatorOrThrow } from '../support/operator-withdrawal.js'

/**
 * RA-235 — E2E: audit-log notification rendering.
 *
 * Counterpart to management-fe PR #100 (RA-234), which makes the audit-log
 * page render the regulator-notification audit actions
 * (`notification-sent` / `notification-skipped` / `notification-failed`)
 * with their structured detail rows (Recipient, Notification type,
 * Reference, Reason, Error) and renders FAILURE entries visually distinct
 * (a red GOV.UK "Failed" tag plus the `app-audit-entry--failure` red
 * left-border class).
 *
 * Part of epic RA-227.
 *
 * SENT path is exercised through the withdraw flow (RA-204): withdrawing a
 * re-accreditation work item with the seeded default operator email
 * (test@defra.gov.uk) sends the "Withdrawn" email, which the backend
 * records as a `notification-sent` audit entry carrying the recipient,
 * notification type (templateKey) and reference (the work item id).
 *
 * RA-317 removed the CM withdraw affordance, so the withdrawal is driven
 * through management-be's operator withdraw endpoint. The notification hook
 * fires identically on that transition, so the sent entry is produced the
 * same way.
 *
 * The failure path is documented as a known gap below — see the pending
 * test — because the e2e stack cannot force a failed send (NOTIFY_API_KEY
 * is absent so the always-successful NoOpNotifyClient stands in, and the
 * harness exposes no failure-injection mechanism). Faking a failed send
 * would not exercise the real backend audit path, so it is deliberately
 * left pending rather than stubbed.
 */
describe('RA-235 audit-log notification rendering', () => {
  describe('notification-sent entry renders with its detail rows', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      // operatorEmail left at the seeded default (test@defra.gov.uk) so the
      // withdraw send succeeds rather than being skipped — that default is
      // therefore the recipient we assert on below.
      workItemId = (
        await workItems.createWorkItem({
          organisationName: 'Audit Notify Render Ltd',
          siteAddressLine1: '235 Audit Way',
          siteAddressTown: 'London',
          siteAddressPostcode: 'SW1A 1AA',
          material: 'plastic',
          tonnageBand: '0-500'
        })
      ).id

      await withdrawAsOperatorOrThrow(
        workItemId,
        'Withdrawn to exercise the notification audit entry'
      )
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Withdrawn')

      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()
    })

    after(async () => {
      await login.logout()
    })

    it('records a notification-sent audit entry', async () => {
      const sentEntries =
        await detail.auditEntriesForAction('notification-sent')
      expect(sentEntries.length).toBeGreaterThan(0)
    })

    it('shows the recipient detail row on the notification-sent entry', async () => {
      await detail.assertNotificationDetailRow(
        'notification-sent',
        'Recipient',
        'test@defra.gov.uk'
      )
    })

    it('shows the notification-type detail row on the notification-sent entry', async () => {
      await detail.assertNotificationDetailRow(
        'notification-sent',
        'Notification type',
        'Withdrawn'
      )
    })

    it('shows the reference detail row on the notification-sent entry', async () => {
      // The backend stamps the work item id as the Notify client reference.
      await detail.assertNotificationDetailRow(
        'notification-sent',
        'Reference',
        workItemId
      )
    })
  })

  describe('notification-failed entry renders with error styling', () => {
    /**
     * KNOWN GAP (deliberately pending, not skipped silently).
     *
     * RA-234 makes a `notification-failed` audit entry render visually
     * distinct: the `app-audit-entry--failure` red-left-border class on
     * the `<li>` and a red GOV.UK "Failed" tag inside it. The page-object
     * helper `detail.assertNotificationFailureStyling()` asserts exactly
     * that markup and is ready to drive this test.
     *
     * It cannot run end-to-end in this harness: a `notification-failed`
     * entry is only written when GOV.UK Notify rejects a send, but the
     * e2e stack runs with NOTIFY_API_KEY absent, so management-be wires the
     * NoOpNotifyClient — which always returns NotifySendResult.Success.
     * There is no env var, stub, or seed in this repo's test harness to
     * force a failed send. Producing a failure would require either a real
     * Notify rejection or a backend test-only failure-injection hook, and
     * the task explicitly forbids faking the outcome.
     *
     * The failure RENDERING is already covered by the management-fe unit
     * tests for audit-log.js / audit-log.njk on PR #100 (isFailure → the
     * "Failed" tag + failure class). This pending test marks the e2e gap
     * so it is visible in the report rather than silently absent; unskip it
     * once the harness can inject a failed send (tracked under RA-227).
     */
    it.skip('renders a failed notification with the red "Failed" tag and failure class', async () => {
      // Pseudocode for when failure injection exists in the harness:
      //   await ...force a notification-failed entry for a work item...
      //   await detail.gotoAudit()
      //   await detail.expandAllAuditEntryDetails()
      //   const failedEntries =
      //     await detail.auditEntriesForAction('notification-failed')
      //   expect(failedEntries.length).toBeGreaterThan(0)
      //   await detail.assertNotificationFailureStyling()
      //   await detail.assertNotificationDetailRow(
      //     'notification-failed',
      //     'Error',
      //     '<expected Notify error text>'
      //   )
    })
  })
})
