import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import withdraw from '../page-objects/withdraw.page.js'

/**
 * RA-204 — Withdrawal email notification.
 *
 * Withdrawing a re-accreditation application now sends the operator a
 * GOV.UK Notify email (the four `withdraw*` actions map to the new
 * `Withdrawn` template in `ReAccreditationNotificationHook`). The send
 * outcome is recorded on the work item's audit log as a
 * `notification-sent` entry whose display name is
 * "Application withdrawn email sent" — which is what these journeys
 * assert, since the email itself is not observable end-to-end.
 *
 * Both the with-note and without-note paths must produce the sent entry:
 * the withdrawal note only feeds the email's `withdrawal_notes`
 * personalisation and is empty-safe, so its absence must not skip or
 * fail the send.
 */
describe('RA-204 Withdrawal notification', () => {
  describe('withdraw with a note', () => {
    let workItemId

    before(async () => {
      await login.loginAs('assign')
      await workItems.goto()
      // operatorEmail is left at the seeded default (test@defra.gov.uk)
      // so the notification is sent rather than skipped.
      workItemId = (
        await workItems.createWorkItem({
          organisationName: 'Withdraw Notify With Note Ltd',
          siteAddressLine1: '1 Notify Way',
          siteAddressTown: 'London',
          siteAddressPostcode: 'SW1A 1AA',
          material: 'plastic',
          tonnageBand: '0-500'
        })
      ).id
    })

    after(async () => {
      await login.logout()
    })

    it('records an "Application withdrawn email sent" audit entry', async () => {
      await withdraw.gotoFor(workItemId, 'withdraw')
      await withdraw.fillNote('Duplicate application submitted by mistake')
      await withdraw.submit()
      await withdraw.waitForDetailUrl(workItemId)
      await detail.assertState('Withdrawn')

      await detail.gotoAudit()
      await detail.assertAuditEntry('Application withdrawn email sent')

      // The send must not have been skipped (missing operator email) or
      // failed — guard against a regression that maps withdraw to a
      // template but loses the recipient.
      const auditLog = await $('[data-testid="work-item-audit-log"]').getText()
      expect(auditLog).not.toContain('Application withdrawn email skipped')
      expect(auditLog).not.toContain('Application withdrawn email failed')
    })
  })

  describe('withdraw without a note', () => {
    let workItemId

    before(async () => {
      await login.loginAs('assign')
      await workItems.goto()
      workItemId = (
        await workItems.createWorkItem({
          organisationName: 'Withdraw Notify No Note Ltd',
          siteAddressLine1: '2 Notify Way',
          siteAddressTown: 'London',
          siteAddressPostcode: 'SW1A 1AA',
          material: 'plastic',
          tonnageBand: '0-500'
        })
      ).id
    })

    after(async () => {
      await login.logout()
    })

    it('still sends the operator email when no withdrawal note is given', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.triggerAction('withdraw')
      await withdraw.assertOnConfirmPage()
      await withdraw.submit()
      await withdraw.waitForDetailUrl(workItemId)
      await detail.assertState('Withdrawn')

      await detail.gotoAudit()
      await detail.assertAuditEntry('Application withdrawn email sent')

      // The no-note path is the one most likely to regress the
      // recipient/skip logic, so guard it too: the send must not have been
      // skipped (missing operator email) or failed.
      const auditLog = await $('[data-testid="work-item-audit-log"]').getText()
      expect(auditLog).not.toContain('Application withdrawn email skipped')
      expect(auditLog).not.toContain('Application withdrawn email failed')
    })
  })
})
