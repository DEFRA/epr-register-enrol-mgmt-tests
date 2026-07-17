import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'

/**
 * RA-201 — Extend SLA sends the operator a "SLA extended" email.
 *
 * Regression cover for the bug where extend-SLA emails never sent: the
 * SlaExtended GOV.UK Notify template requires an ((sla_deadline))
 * placeholder that the notification hook never supplied, so Notify
 * rejected the send with "Missing personalisation: sla_deadline".
 *
 * Observed through the UI: after a team leader extends the SLA on a
 * re-accreditation work item (which has an operator email and an SLA
 * clock started at payment-received), the audit log gains an
 * "SLA extended email sent" entry. In the e2e stack NOTIFY_API_KEY is
 * absent so the NoOpNotifyClient stands in and reports success, which
 * exercises the same notification-sent audit path as production.
 *
 * The extend itself only succeeds once an SLA clock exists, so the
 * work item is driven to "Assessment in progress" first (payment-received
 * stamps the clock).
 */
describe('RA-201 Extend SLA sends operator notification', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'SLA Notify Test Ltd',
        siteAddressLine1: '3 Notification Way',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AA',
        material: 'plastic',
        tonnageBand: '0-500',
        operatorEmail: 'test@defra.gov.uk'
      })
    ).id

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Submitted')

    // Submitted -> Duly made (auto-transition fires when last submitted task completes)
    await detail.gotoTasks()
    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')
    await detail.gotoDetail()
    await detail.assertState('Duly made')

    // Duly made -> Assessment in progress. payment-received stamps the
    // SLA clock, without which the extend below would fail with
    // "clock not started" and no notification would fire.
    await detail.gotoTasks()
    await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('payment-received')
    await detail.assertState('Assessment in progress')

    await login.logout()
  })

  after(async () => {
    await login.logout()
  })

  it('records an "SLA extended email sent" audit entry after a successful extend', async () => {
    await login.login()

    await slaExtend.gotoFor(workItemId)
    await slaExtend.fillForm({
      reason: 'Operator providing additional evidence',
      additionalDays: 7
    })
    await slaExtend.submitForm()
    await slaExtend.waitForDetailUrl(workItemId)

    // The extend succeeded (clock present) so a success banner shows.
    await detail.assertFlashBanner()

    // The notification hook fired and the send succeeded, so the audit
    // log carries the "SLA extended email sent" entry — proving the
    // extend wires through to a notification end-to-end. (In this stack
    // NOTIFY_API_KEY is absent so the NoOpNotifyClient stands in; the
    // sla_deadline placeholder-contract regression itself is guarded by
    // the management-be NotifyTemplateContractTests, which the real
    // GovukNotifyClient would otherwise have 400'd on.)
    await detail.gotoAudit()
    await detail.assertAuditEntry('SLA extended email sent')
  })
})
