import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  confirmApplicantContact,
  dulyMake,
  logDecision,
  startAssessment
} from '../support/re-accreditation-journey.js'
import {
  createOperatorBackedWorkItem,
  getOperatorApplication,
  requestAccreditationNumberAsCaseManagement
} from '../support/operator-backend-api.js'
import { isCaseManagementPushEnabled } from '../support/backend-api.js'

/**
 * RA-133 — Approving a re-accreditation surfaces a generated
 * accreditation id, start date and year on the detail page.
 *
 * The journey:
 *   1. An operator submits a re-accreditation through the operator journey
 *      backend, which creates the work item (state = Submitted). The
 *      decision is pushed to that backend, so it must own the application.
 *   2. The work item is duly made, then "Assign to yourself and start"
 *      starts it (`assessment-started`, still "Duly made").
 *   3. A caseworker approves the work item (RA-323 — every caseworker
 *      holds the same role).
 *   4. The backend issues a fixed 17-char accreditation id and stamps a
 *      start date + year onto the payload. The frontend renders a
 *      govukPanel confirmation and a summary list with all three values,
 *      which is what we assert here.
 *
 * RA-690: the accreditation id is DERIVED from the application's
 * registration reference (leading R becomes A, YY becomes the application's
 * own year, every other character unchanged), never drawn from a counter.
 */

/** RA-690: `A` + the application year's YY + registration ref chars 4–17. */
function expectedAccreditationReference({ registrationReference, year }) {
  return `A${String(year % 100).padStart(2, '0')}${registrationReference.slice(3)}`
}

// The retry replays management-be's own call, signed as management-be, so it
// only runs where the suite may do that (see support/backend-api.js).
const itIfCaseManagementPush = isCaseManagementPushEnabled() ? it : it.skip

describe('RA-133 approval generates accreditation id, start date and year', () => {
  let workItem
  let issuedAccreditationReference
  let approvedAccreditationId

  it('creates a re-accreditation and drives it to assessment-started', async () => {
    await login.login()
    workItem = await createOperatorBackedWorkItem()

    await workItems.openWorkItem(workItem.id)
    await detail.assertState('Not started')

    // Submitted -> Duly made. RA-316 replaced the submitted tasks and
    // the auto-transition hook with the "Duly make" CTA and a payment
    // date; the shared helper owns that journey.
    await dulyMake(workItem.id)

    // Duly made -> started (`assessment-started`, still "Duly made")
    await startAssessment(workItem.id)
    // `assessment-started` displays as "Duly made" (RA-527 follow-up: a
    // start keeps the case Duly made), so the raw id is what pins the
    // state. RA-410 removed the
    // `submit-for-decision` step that used to follow: `awaiting-decision`
    // is now an internal hop inside the Log decision call, so this is
    // where the item waits.
    await detail.assertStateId('assessment-started')

    await login.logout()
  })

  it('logs the approval and the backend issues the accreditation id derived from the registration reference', async () => {
    await login.login()
    await workItems.openWorkItem(workItem.id)
    await detail.assertStateId('assessment-started')

    await logDecision(workItem.id, 'approved')

    // RA-527: the determination is step 1; Granted needs step 2. Task 007:
    // step 1 stamps only the number, so only its row shows until then.
    expect(await detail.decisionMetadataRowKeys()).toEqual(['Accreditation ID'])

    // RA-690: step 1 asked the operator backend for the number. It must be
    // the registration reference with R -> A and the application's own YY.
    const application = await getOperatorApplication(
      workItem.operatorOrganisationId,
      workItem.operatorApplicationId
    )
    expect(application.registrationReference).toMatch(
      /^R\d{2}[ESNW][RX]\d{6}\d{4}PL$/
    )
    expect(application.accreditationReference).toBe(
      expectedAccreditationReference(application)
    )
    issuedAccreditationReference = application.accreditationReference

    await login.logout()
  })

  // RA-690: a retried accreditation-number request (e.g. after a lost reply)
  // returns the reference already issued, never a new one. Replayed between
  // the two approval steps, as management-be would: once Granted, the
  // operator backend treats the application as final and refuses any change.
  itIfCaseManagementPush(
    'a repeated accreditation-number request returns the same reference',
    async () => {
      const retry = await requestAccreditationNumberAsCaseManagement(workItem)

      expect(retry.status).toBe(200)
      expect(retry.body.accreditationReference).toBe(
        issuedAccreditationReference
      )
      const application = await getOperatorApplication(
        workItem.operatorOrganisationId,
        workItem.operatorApplicationId
      )
      expect(application.accreditationReference).toBe(
        issuedAccreditationReference
      )
    }
  )

  it('confirms applicant contact and renders the accreditation id, start date and year', async () => {
    await login.login()
    await confirmApplicantContact(workItem.id)

    await detail.assertState('Granted')
    await detail.assertApprovalPanelVisible()
    // Step 2 stamps the start date and year: all three rows now show.
    expect(await detail.decisionMetadataRowKeys()).toEqual([
      'Accreditation ID',
      'Accreditation start date',
      'Accreditation year'
    ])

    // RA-177. The "Accreditation issued" success panel and its metadata
    // must render above the generic envelope attributes summary.
    await detail.assertApprovalPanelAboveSummary()

    const accreditationId = await detail.getAccreditationId()
    // The id the caseworker sees is the one the operator backend issued.
    expect(accreditationId).toBe(issuedAccreditationReference)
    // Captured for the idempotency test below, which asserts the exact
    // value again after a re-visit.
    approvedAccreditationId = accreditationId

    const year = await detail.getAccreditationYear()
    expect(year).toMatch(/^\d{4}$/)
    // RA-690: the id's YY is the year the operator applied for (the
    // application's own year, checked in step 1 above), not this year, which
    // management-be stamps from its configured accreditation year. The two
    // can differ, e.g. on a late approval after the configured year rolls
    // over, and on the compose stack, where the helper seeds the calendar year.

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
    await workItems.openWorkItem(workItem.id)
    await detail.assertState('Granted')
    await detail.assertApprovalPanelVisible()
    const accreditationIdOnReturn = await detail.getAccreditationId()
    // RA-448 phase 2 review: this is the assertion that actually makes the
    // test title true. A shape-only check would stay green even if
    // re-approving called the number adapter again and got a DIFFERENT but
    // still validly-shaped id. Comparing against the id captured from the
    // first approval is what catches that regression.
    expect(accreditationIdOnReturn).toBe(approvedAccreditationId)
    await login.logout()
  })
})
