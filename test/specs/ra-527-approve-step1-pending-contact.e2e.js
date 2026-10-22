import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { driveToApprovedPendingContact } from '../support/re-accreditation-journey.js'
import {
  createOperatorBackedWorkItem,
  getOperatorApplication
} from '../support/operator-backend-api.js'

/**
 * RA-527 (task 003) — step 1 of the two-step determination, for approvals.
 *
 * "Make determination" with Approved records the determination and mints the
 * accreditation number, but does NOT apply the outcome: the work item lands
 * in `approved-pending-contact` (tagged "Approved", light blue), the operator
 * journey is not told, and the only way forward is "Confirm applicant
 * contact" (step 2, task 004).
 *
 * Operator-backed (Path B) so the operator journey's own copy of the status
 * can be read back: it must still say what it said before the determination.
 *
 * Task 007 adds the full two-step spec (both steps, both outcomes); this one
 * pins step 1 of an approval on its own.
 */
describe('RA-527: approving is step 1 — pending applicant contact', () => {
  let workItemId
  let application

  before(async () => {
    await login.login()
    application = await createOperatorBackedWorkItem()
    workItemId = application.id
    await driveToApprovedPendingContact(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('tags the work item "Approved" in light blue', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('approved-pending-contact')
    expect(await detail.stateTagText()).toBe('Approved')
    await detail.assertStateTagClass('govuk-tag--light-blue')
  })

  it('shows the "Application approved" banner with the minted accreditation ID', async () => {
    expect(await detail.hasPendingContactBanner()).toBe(true)
    expect(await detail.pendingContactBannerTitle()).toBe(
      'Application approved'
    )
    const accreditationId = await detail.pendingContactAccreditationId()
    // Minted by the Registration & Accreditation service backend for this
    // plastic (PL) application, in the public-register format.
    expect(accreditationId).toMatch(/^A\d{2}[ESNW][RX]\d{6}\d{4}PL$/)
    expect(await detail.pendingContactBannerText()).toBe(
      'The application was approved. You now need to contact the applicant about the decision. ' +
        `Accreditation ID: ${accreditationId}`
    )
  })

  it('keeps the banner on every visit', async () => {
    await browser.refresh()
    await detail.assertStateId('approved-pending-contact')
    expect(await detail.hasPendingContactBanner()).toBe(true)
  })

  it('offers "Confirm applicant contact" and no further determination', async () => {
    expect(await detail.hasConfirmApplicantContactCta()).toBe(true)
    expect(await detail.confirmApplicantContactCtaText()).toBe(
      'Confirm applicant contact'
    )
    expect(await detail.confirmApplicantContactHref()).toContain(
      `/work-items/re-accreditation/${workItemId}/confirm-contact`
    )
    expect(await detail.hasLogDecisionCta()).toBe(false)
    expect(await detail.hasAction('query')).toBe(false)
    expect(await detail.hasAction('sla-extend')).toBe(false)
  })

  it('leaves only Reassign and Unassign in the assignment box', async () => {
    expect(await detail.hasAssignmentControl('reassign')).toBe(true)
    expect(await detail.hasAssignmentControl('unassign')).toBe(true)
    expect(await detail.hasAssignmentControl('selfAssign')).toBe(false)
  })

  it('records the determination, but pushes nothing to the operator journey', async () => {
    await detail.gotoAudit()
    await detail.assertAuditEntry('Determination made: Approved')
    // Duly make and start-assessment each pushed once; the determination
    // must not add a third.
    const statusPushes = await detail.waitForAuditEntryCount(
      'status-push-sent',
      2
    )
    expect(statusPushes.length).toBe(2)
  })

  it("leaves the operator journey's status as it was before the determination", async () => {
    const operatorApplication = await getOperatorApplication(
      application.operatorOrganisationId,
      application.operatorApplicationId
    )
    // assessment-in-progress reads as Updated on that side; GRANTED only
    // arrives with step 2.
    expect(operatorApplication.applicationStatus).toBe('Updated')
  })
})
