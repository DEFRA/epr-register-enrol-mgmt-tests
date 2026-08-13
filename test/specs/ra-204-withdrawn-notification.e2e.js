import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import withdraw from '../page-objects/withdraw.page.js'

/**
 * RA-204 — Withdrawal notification, under the RA-422 default.
 *
 * Withdrawing a re-accreditation application used to send the operator a
 * GOV.UK Notify "Withdrawn" email and record the outcome as a
 * `notification-sent` audit entry ("Application withdrawn email sent").
 * RA-422 put all Case Management email functionality behind the
 * `Notify:Enabled` feature flag (default false), and the e2e stack runs with
 * it OFF.
 *
 * The flag gates the single post-action hook that BOTH sends the email AND
 * writes that audit entry, so with it off the withdraw still completes (state
 * -> Withdrawn) but NO "Application withdrawn email" row is written. These
 * journeys assert that new default on both the with-note and without-note
 * paths (the withdrawal note only ever fed the email personalisation).
 */
describe('RA-204 Withdrawal records no email notification (Notify flag off)', () => {
  describe('withdraw with a note', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      // operatorEmail is left at the seeded default (test@defra.gov.uk); with
      // the Notify flag off it is moot, but keeps the fixture realistic.
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

    it('records NO withdrawal email audit entry (emails disabled by RA-422)', async () => {
      await withdraw.gotoFor(workItemId, 'withdraw')
      await withdraw.fillNote('Duplicate application submitted by mistake')
      await withdraw.submit()
      await withdraw.waitForDetailUrl(workItemId)
      // The withdraw lifecycle action still completes — the state moves to
      // Withdrawn — it just no longer notifies while Notify:Enabled is off.
      await detail.assertState('Withdrawn')

      // With the Notify flag off, the post-action hook that BOTH sends the
      // email AND writes the notification audit row never fires, so no
      // "Application withdrawn email" entry (sent, skipped or failed) exists.
      await detail.gotoAudit()
      await detail.assertNoAuditEntry('Application withdrawn email sent')
      await detail.assertNoAuditEntry('Application withdrawn email skipped')
      await detail.assertNoAuditEntry('Application withdrawn email failed')
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

    it('records NO withdrawal email audit entry on the no-note path either', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.triggerAction('withdraw')
      await withdraw.assertOnConfirmPage()
      await withdraw.submit()
      await withdraw.waitForDetailUrl(workItemId)
      await detail.assertState('Withdrawn')

      // Same as the with-note path: no notification hook fires with the Notify
      // flag off, so no withdrawal email audit row is recorded.
      await detail.gotoAudit()
      await detail.assertNoAuditEntry('Application withdrawn email sent')
      await detail.assertNoAuditEntry('Application withdrawn email skipped')
      await detail.assertNoAuditEntry('Application withdrawn email failed')
    })
  })
})
