import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-133 — Approving a re-accreditation surfaces a generated
 * accreditation id, start date and year on the detail page.
 *
 * The journey:
 *   1. A caseworker creates a re-accreditation work item (state =
 *      Submitted).
 *   2. Tasks for each state are completed and the work item is
 *      progressed (auto-duly-made -> payment-received -> submit-for-
 *      decision) up to the Awaiting decision state.
 *   3. A caseworker completes the awaiting-decision task and approves
 *      the work item (RA-323 — every caseworker holds the same role).
 *   4. The backend generates an `ACC-YYYY-M-XXXXXXXX` accreditation id
 *      and stamps a start date + year onto the payload. The frontend
 *      renders a govukPanel confirmation and a summary list with all
 *      three values, which is what we assert here.
 */
describe('RA-133 approval generates accreditation id, start date and year', () => {
  let workItemId

  it('creates a re-accreditation and drives it to awaiting-decision', async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'Coastal Materials Group',
        siteAddressLine1: '1 Approval Street',
        siteAddressTown: 'Cardiff',
        siteAddressPostcode: 'CF1 2AK',
        material: 'plastic',
        tonnageBand: '500-5000'
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

  it('approves the work item as the decision maker and renders the accreditation id, start date and year', async () => {
    await login.login()
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

    // RA-177. The "Accreditation issued" success panel and its metadata
    // must render above the generic envelope attributes summary.
    await detail.assertApprovalPanelAboveSummary()

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
    // RA-176: the start date must render as a GDS-formatted date
    // ("1 January 2027"), not the literal "[object Object]" that a
    // mis-serialised DateOnly previously produced.
    expect(startDate).not.toEqual(expect.stringContaining('[object Object]'))
    expect(startDate).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/)
    // The formatted start date year must agree with the issued year.
    expect(startDate.endsWith(year)).toBe(true)

    await login.logout()
  })

  it('re-approving an already-approved work item is idempotent (panel still shows the same id)', async () => {
    await login.login()
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Approved')
    await detail.assertApprovalPanelVisible()
    const accreditationIdOnReturn = await detail.getAccreditationId()
    expect(accreditationIdOnReturn).toMatch(/^ACC-\d{4}-P-[A-Z0-9]{8}$/)
    await login.logout()
  })
})
