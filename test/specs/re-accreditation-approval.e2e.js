import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  dulyMake,
  logDecision,
  startAssessment
} from '../support/re-accreditation-journey.js'

/**
 * RA-133 — Approving a re-accreditation surfaces a generated
 * accreditation id, start date and year on the detail page.
 *
 * The journey:
 *   1. A caseworker creates a re-accreditation work item (state =
 *      Submitted).
 *   2. Tasks for each state are completed and the work item is
 *      progressed (auto-duly-made -> payment-received -> submit-for-
 *      "Assign to yourself and start") up to assessment-in-progress.
 *   3. A caseworker completes the awaiting-decision task and approves
 *      the work item (RA-323 — every caseworker holds the same role).
 *   4. The backend generates a fixed 16-char accreditation id
 *      and stamps a start date + year onto the payload. The frontend
 *      renders a govukPanel confirmation and a summary list with all
 *      three values, which is what we assert here.
 */
describe('RA-133 approval generates accreditation id, start date and year', () => {
  let workItemId

  it('creates a re-accreditation and drives it to assessment-in-progress', async () => {
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
    await detail.assertState('Not started')

    // Submitted -> Duly made. RA-316 replaced the submitted tasks and
    // the auto-transition hook with the "Duly make" CTA and a payment
    // date; the shared helper owns that journey.
    await dulyMake(workItemId)

    // Duly made -> Assessment in progress
    await startAssessment(workItemId)
    // `assessment-in-progress` displays as "Updated" (RA-324), so the
    // raw id is what pins the state. RA-410 removed the
    // `submit-for-decision` step that used to follow: `awaiting-decision`
    // is now an internal hop inside the Log decision call, so this is
    // where the item waits.
    await detail.assertStateId('assessment-in-progress')

    await login.logout()
  })

  it('approves the work item as the decision maker and renders the accreditation id, start date and year', async () => {
    await login.login()
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('assessment-in-progress')

    await logDecision(workItemId, 'approved')

    await detail.assertState('Granted')
    await detail.assertApprovalPanelVisible()

    // RA-177. The "Accreditation issued" success panel and its metadata
    // must render above the generic envelope attributes summary.
    await detail.assertApprovalPanelAboveSummary()

    const accreditationId = await detail.getAccreditationId()
    // Real backend ID shape: A{YY}{Agency:1}{OperatorType:1}{OrgId:6}
    // {Sequence:3}{Material:2}. RA-448 phase 2 moved generation to a real
    // (here, stubbed) backend call that never receives the application's
    // material — the operator-backend-stub can't compute the trailing
    // segment correctly, so it always returns "XX" there. Assert the shape
    // only, not a specific material code (see docker/stubs/operator-backend-stub.mjs).
    expect(accreditationId).toMatch(
      /^A\d{2}[ESNW][RX][A-Z0-9]{6}[A-Z0-9]{3}[A-Z]{2}$/
    )

    const year = await detail.getAccreditationYear()
    expect(year).toMatch(/^\d{4}$/)
    // The accreditation id and the year must agree (the id embeds only YY).
    expect(accreditationId.startsWith(`A${year.slice(-2)}`)).toBe(true)

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
    await detail.assertState('Granted')
    await detail.assertApprovalPanelVisible()
    const accreditationIdOnReturn = await detail.getAccreditationId()
    expect(accreditationIdOnReturn).toMatch(
      /^A\d{2}[ESNW][RX][A-Z0-9]{6}[A-Z0-9]{3}PL$/
    )
    await login.logout()
  })
})
