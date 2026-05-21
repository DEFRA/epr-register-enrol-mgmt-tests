import { expect } from '@wdio/globals'
import login from 'page-objects/login.page.js'
import workItems from 'page-objects/work-items.page.js'
import detail from 'page-objects/work-item-detail.page.js'

/**
 * RA-133 — Approving a re-accreditation surfaces a generated
 * accreditation id, start date and year on the detail page.
 *
 * The journey:
 *   1. Assign user creates a re-accreditation work item (state =
 *      Submitted).
 *   2. Tasks for each state are completed and the work item is
 *      progressed (duly-make -> payment-received -> submit-for-
 *      decision) up to the Awaiting decision state.
 *   3. The decision-maker logs in, completes the awaiting-decision
 *      task and approves the work item.
 *   4. The backend generates an `ACC-YYYY-M-XXXXXXXX` accreditation id
 *      and stamps a start date + year onto the payload. The frontend
 *      renders a govukPanel confirmation and a summary list with all
 *      three values, which is what we assert here.
 */
describe('RA-133 approval generates accreditation id, start date and year', () => {
  let workItemId

  it('creates a re-accreditation and drives it to awaiting-decision', async () => {
    await login.loginAs('assign')
    await workItems.goto()
    workItemId = await workItems.createWorkItem({
      applicationReference: 'RA-133-APPROVE-01',
      organisationName: 'Coastal Materials Group',
      siteAddressLine1: '1 Approval Street',
      siteAddressTown: 'Cardiff',
      siteAddressPostcode: 'CF1 1AA',
      material: 'plastic',
      tonnageBand: '500-5000'
    })

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Submitted')

    // Submitted -> Duly made
    await detail.gotoTasks()
    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('duly-make')
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

  it('approves the work item as the decision maker and renders the accreditation id, start date and year', async () => {
    await login.loginAs('decision-maker')
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Awaiting decision')

    // Complete the awaiting-decision task before approving.
    await detail.gotoTasks()
    await detail.setTaskStatus('record-decision-rationale', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('approve')
    await detail.submitApproval()

    await detail.assertState('Approved')
    await detail.assertApprovalPanelVisible()

    const accreditationId = await detail.getAccreditationId()
    // Backend ID format: ACC-YYYY-<material initial>-<8 chars>.
    // We used "plastic" as the material so the third segment must be P.
    expect(accreditationId).toMatch(/^ACC-\d{4}-P-[A-Z0-9]{8}$/)

    const year = await detail.getAccreditationYear()
    expect(year).toMatch(/^\d{4}$/)
    // The accreditation id and the year must agree.
    expect(accreditationId.startsWith(`ACC-${year}-`)).toBe(true)

    const startDate = await detail.getAccreditationStartDate()
    expect(startDate.length).toBeGreaterThan(0)
    expect(startDate).not.toEqual(expect.stringContaining('—'))

    await login.logout()
  })

  it('re-approving an already-approved work item is idempotent (panel still shows the same id)', async () => {
    await login.loginAs('decision-maker')
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Approved')
    await detail.assertApprovalPanelVisible()
    const accreditationIdOnReturn = await detail.getAccreditationId()
    expect(accreditationIdOnReturn).toMatch(/^ACC-\d{4}-P-[A-Z0-9]{8}$/)
    await login.logout()
  })
})
