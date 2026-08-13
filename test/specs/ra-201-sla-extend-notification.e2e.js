import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import {
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'

/**
 * RA-201 — Extend SLA no longer emails the operator once Case Management
 * emails are disabled behind the Notify:Enabled feature flag (RA-422,
 * default false — the e2e stack runs with it off).
 *
 * The flag gates the single post-action hook that BOTH sends the
 * "SLA extended" email AND writes its notification audit entry, so with the
 * flag off the extend still succeeds (success banner) but the audit log gains
 * NO "SLA extended email" entry. This spec proves that new default.
 *
 * The extend itself only succeeds once an SLA clock exists, so the work item
 * is driven to "Assessment in progress" first (payment-received stamps the
 * clock).
 */
describe('RA-201 Extend SLA records no operator email (Notify flag off)', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'SLA Notify Test Ltd',
        siteAddressLine1: '3 Notification Way',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AP',
        material: 'plastic',
        tonnageBand: '0-500',
        operatorEmail: 'test@defra.gov.uk'
      })
    ).id

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Not started')

    // Submitted -> Duly made. RA-316 replaced the submitted tasks and
    // the auto-transition hook with the "Duly make" CTA and a payment
    // date; the shared helper owns that journey.
    await dulyMake(workItemId)

    // Duly made -> Assessment in progress. payment-received stamps the
    // SLA clock, without which the extend below would fail with
    // "clock not started" and the success banner would not show.
    await startAssessment(workItemId)
    await detail.assertState('Updated')

    await login.logout()
  })

  after(async () => {
    await login.logout()
  })

  it('records NO "SLA extended email" audit entry after a successful extend', async () => {
    await login.login()

    await slaExtend.gotoFor(workItemId)
    await slaExtend.fillForm({
      reason: 'Operator providing additional evidence',
      additionalDays: 7
    })
    await slaExtend.submitForm()
    await slaExtend.waitForDetailUrl(workItemId)

    // The extend itself still succeeds (clock present) so a success banner
    // shows — the lifecycle action is unaffected by the Notify flag.
    await detail.assertFlashBanner()

    // With Notify:Enabled off (the e2e default), the post-action hook that
    // BOTH sends the email AND writes the notification audit row never fires,
    // so no "SLA extended email" entry appears in the audit log.
    await detail.gotoAudit()
    await detail.assertNoAuditEntry('SLA extended email sent')
    await detail.assertNoAuditEntry('SLA extended email skipped')
    await detail.assertNoAuditEntry('SLA extended email failed')
  })
})
