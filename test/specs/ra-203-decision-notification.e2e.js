import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-203 — Approving a re-accreditation sends the operator the decision
 * email.
 *
 * Regression cover for the bug where decision emails never sent: the
 * Decision GOV.UK Notify template requires a ((decision_notes))
 * placeholder that the notification hook never supplied, so Notify
 * rejected the send with "Missing personalisation: decision_notes".
 *
 * Observed through the UI: after a decision maker approves with a
 * decision note, the audit log gains a "Decision recorded: approved
 * email sent" entry. In the e2e stack NOTIFY_API_KEY is absent so the
 * NoOpNotifyClient stands in and reports success, which exercises the
 * same notification-sent audit path as production. The decision_notes
 * placeholder-contract regression itself is guarded by the management-be
 * NotifyTemplateContractTests, which the real GovukNotifyClient would
 * otherwise have 400'd on.
 */
describe('RA-203 Approval sends operator decision notification', () => {
  let workItemId

  it('drives a re-accreditation to awaiting-decision', async () => {
    await login.loginAs('assign')
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'Decision Notify Test Ltd',
        siteAddressLine1: '4 Decision Road',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AQ',
        material: 'plastic',
        tonnageBand: '0-500',
        operatorEmail: 'operator@decision-notify-test.example'
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

    // Duly made -> Assessment in progress
    await detail.gotoTasks()
    await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('payment-received')
    await detail.assertState('Assessment in progress')

    // Assessment in progress -> Awaiting decision
    await detail.gotoTasks()
    await detail.setTaskStatus('review-compliance-history', 'Completed')
    await detail.setTaskStatus('assess-technical-capacity', 'Completed')
    await detail.setTaskStatus('assess-financial-capacity', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('submit-for-decision')
    await detail.assertState('Awaiting decision')

    await login.logout()
  })

  it('records a "Decision recorded: approved email sent" audit entry after approval with a note', async () => {
    await login.loginAs('decision-maker')
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Awaiting decision')

    await detail.gotoTasks()
    await detail.setTaskStatus('record-decision-rationale', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('approve')

    // The decision note is posted as a work-item note before the approve
    // transition; the notification hook reads it for the Decision email's
    // decision_notes placeholder (RA-203).
    await detail.setDecisionNote(
      'Application meets all re-accreditation criteria.'
    )
    await detail.submitApproval()
    await detail.assertState('Approved')

    // The notification hook fired and the send succeeded, so the audit
    // log carries the "Decision recorded: approved email sent" entry —
    // proving the approval wires through to a notification end-to-end.
    await detail.gotoAudit()
    await detail.expandAllAuditEntryDetails()
    await detail.assertAuditEntry('Decision recorded: approved email sent')

    await login.logout()
  })
})
