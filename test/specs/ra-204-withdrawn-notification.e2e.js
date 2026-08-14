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
 * `withdrawal_notes` personalisation. Unlike the old CM flow's OPTIONAL note,
 * the operator endpoint mandates a non-empty reason, so the former
 * "without a note" path is no longer reachable (see the note where it was).
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

  // The old CM withdraw flow had an OPTIONAL note, so a "without a note" case
  // used to exercise the empty-note send path. The operator endpoint that
  // replaces it (RA-317) REQUIRES a non-empty reason —
  // `ReAccreditationWithdrawValidator` rejects a blank one with a 400 "Enter a
  // reason for the withdrawal" — so an empty-reason withdrawal is not reachable
  // through the surviving route, and that case is removed rather than made to
  // pass a reason it is meant to omit. The with-a-note case above already
  // proves the Withdrawn email sends.
})
