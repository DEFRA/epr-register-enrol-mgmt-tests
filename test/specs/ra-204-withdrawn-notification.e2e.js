import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { withdrawAsOperatorOrThrow } from '../support/operator-withdrawal.js'

/**
 * RA-204 — Withdrawal email notification.
 *
 * Withdrawing a re-accreditation application sends the operator a GOV.UK
 * Notify email (the withdraw transitions map to the `Withdrawn` template in
 * `ReAccreditationNotificationHook`). The send outcome is recorded on the
 * work item's audit log as a `notification-sent` entry whose display name is
 * "Application withdrawn email sent" — which is what these journeys assert,
 * since the email itself is not observable end-to-end.
 *
 * RA-317 removed the case-management withdraw affordance: withdrawal is an
 * OPERATOR action now, driven through management-be's withdraw endpoint. The
 * notification hook fires on that operator-initiated transition just as it did
 * on the old CM journey, so the sent entry is still recorded — which is itself
 * AC03 (an operator withdrawal surfaces in case management). The withdrawal
 * `reason` supplied to the endpoint becomes the note that feeds the email's
 * `withdrawal_notes` personalisation and is empty-safe, so both the with-note
 * and without-note paths must still produce the sent entry.
 */
describe('RA-204 Withdrawal notification', () => {
  describe('withdraw with a note', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      // operatorEmail is left at the seeded default (test@defra.gov.uk)
      // so the notification is sent rather than skipped.
      workItemId = (
        await workItems.createWorkItem({
          organisationName: 'Withdraw Notify With Note Ltd',
          siteAddressLine1: '1 Notify Way',
          siteAddressTown: 'London',
          siteAddressPostcode: 'SW1A 1AR',
          material: 'plastic',
          tonnageBand: '0-500'
        })
      ).id
    })

    after(async () => {
      await login.logout()
    })

    it('records an "Application withdrawn email sent" audit entry', async () => {
      await withdrawAsOperatorOrThrow(
        workItemId,
        'Duplicate application submitted by mistake'
      )
      await workItems.openWorkItem(workItemId)
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
      await login.login()
      await workItems.goto()
      workItemId = (
        await workItems.createWorkItem({
          organisationName: 'Withdraw Notify No Note Ltd',
          siteAddressLine1: '2 Notify Way',
          siteAddressTown: 'London',
          siteAddressPostcode: 'SW1A 1AS',
          material: 'plastic',
          tonnageBand: '0-500'
        })
      ).id
    })

    after(async () => {
      await login.logout()
    })

    it('still sends the operator email when no withdrawal note is given', async () => {
      // No reason passed: the note is blank, which the hook is empty-safe
      // against. This is the path most likely to regress the recipient/skip
      // logic, so it is exercised end-to-end too.
      await withdrawAsOperatorOrThrow(workItemId)
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Withdrawn')

      await detail.gotoAudit()
      await detail.assertAuditEntry('Application withdrawn email sent')

      const auditLog = await $('[data-testid="work-item-audit-log"]').getText()
      expect(auditLog).not.toContain('Application withdrawn email skipped')
      expect(auditLog).not.toContain('Application withdrawn email failed')
    })
  })
})
