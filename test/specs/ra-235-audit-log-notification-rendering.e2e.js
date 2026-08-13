import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import withdraw from '../page-objects/withdraw.page.js'

/**
 * RA-235 — E2E: audit-log notification rendering, under the RA-422 default.
 *
 * management-fe PR #100 (RA-234) made the audit-log page render the
 * regulator-notification audit actions (`notification-sent` /
 * `notification-skipped` / `notification-failed`) with their structured
 * detail rows and distinct failure styling. RA-422 then put all Case
 * Management email functionality behind the `Notify:Enabled` feature flag
 * (default false), and the e2e stack runs with it OFF.
 *
 * The flag gates the single post-action hook that BOTH sends the emails AND
 * writes those notification audit entries, so with it off NO `notification-*`
 * rows are written at all — there is nothing for the RA-234 rendering to
 * render. The rendering itself stays covered by the management-fe unit tests
 * (audit-log.js / audit-log.njk); end-to-end, the honest assertion under the
 * current default is that a lifecycle action records no notification entry.
 *
 * The SENT path used to be exercised through the withdraw flow (RA-204): the
 * withdraw still succeeds (state -> Withdrawn), it simply no longer notifies.
 *
 * Part of epic RA-227.
 */
describe('RA-235 audit-log notification rendering (disabled by RA-422)', () => {
  describe('a lifecycle action records no notification audit entry', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      // operatorEmail left at the seeded default (test@defra.gov.uk); with the
      // Notify flag off it is moot, but keeps the fixture realistic.
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

      await withdraw.gotoFor(workItemId, 'withdraw')
      await withdraw.fillNote(
        'Withdrawn to exercise the (now disabled) notification audit entry'
      )
      await withdraw.submit()
      await withdraw.waitForDetailUrl(workItemId)
      await detail.assertState('Withdrawn')

      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()
    })

    after(async () => {
      await login.logout()
    })

    it('records no notification-sent audit entry after the withdraw', async () => {
      const sentEntries =
        await detail.auditEntriesForAction('notification-sent')
      expect(sentEntries.length).toBe(0)
    })

    it('records no notification-skipped or notification-failed entry either', async () => {
      const skipped = await detail.auditEntriesForAction('notification-skipped')
      const failed = await detail.auditEntriesForAction('notification-failed')
      expect(skipped.length).toBe(0)
      expect(failed.length).toBe(0)
    })

    it('does not render an "Application withdrawn email" audit row', async () => {
      await detail.assertNoAuditEntry('Application withdrawn email sent')
      await detail.assertNoAuditEntry('Application withdrawn email skipped')
      await detail.assertNoAuditEntry('Application withdrawn email failed')
    })
  })
})
