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
 * RA-249 — the application reference must survive approval.
 *
 * Approving a re-accreditation used to rewrite the whole stored payload
 * from a model that ignored unmodelled keys, dropping
 * `payload.applicationReference`. With the human reference gone, the
 * frontend fell back to the internal work-item GUID and rendered that as
 * the "Application reference" (and page caption) — so an approved item
 * showed e.g. `88e380d5-74ff-4c86-bd8a-a56860a3c2b5` instead of the
 * server-generated `AP*` reference (RA-318 format: `AP` + year + agency +
 * orgId + postcode suffix + material prefix).
 *
 * This journey drives a re-accreditation all the way to Granted and then
 * asserts the "Application reference" row and the page caption still show
 * the `AP*` reference — never a UUID.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('RA-249 — application reference survives approval', () => {
  let createdId
  let applicationReference

  it('creates a re-accreditation and drives it to awaiting-decision', async () => {
    await login.login()
    await workItems.goto()
    ;({ id: createdId, applicationReference } = await workItems.createWorkItem({
      organisationName: 'Persistent Reference Recyclers',
      siteAddressLine1: '1 Persistence Road',
      siteAddressTown: 'Cardiff',
      siteAddressPostcode: 'CF1 1AA',
      material: 'plastic',
      tonnageBand: '500-5000'
    }))

    // Sanity: the server-generated reference is a real AP* ref, not the GUID.
    expect(applicationReference).toMatch(/^AP[A-Z0-9]+$/)
    expect(applicationReference).not.toBe(createdId)

    await workItems.openWorkItem(createdId)
    await detail.assertState('Not started')

    // Submitted -> Duly made. RA-316 replaced the submitted tasks and
    // the auto-transition hook with the "Duly make" CTA and a payment
    // date; the shared helper owns that journey.
    await dulyMake(createdId)

    // Duly made -> Assessment in progress
    await startAssessment(createdId)
    // `assessment-in-progress` displays as "Updated" (RA-324), so the
    // raw id is what pins the state. RA-410 removed the
    // `submit-for-decision` step that used to follow: `awaiting-decision`
    // is now an internal hop inside the Log decision call, so this is
    // where the item waits.
    await detail.assertStateId('assessment-in-progress')

    await login.logout()
  })

  it('keeps the AP* application ref after the decision maker approves it', async () => {
    await login.login()
    await workItems.openWorkItem(createdId)
    await detail.assertStateId('assessment-in-progress')

    await logDecision(createdId, 'approved')

    await detail.assertState('Granted')
    await detail.assertApprovalPanelVisible()

    // The core RA-249 assertion: the "Application reference" row must still
    // be the human AP* reference, never the internal GUID / a UUID.
    const value = await detail.getSummaryValueByKey('Application reference')
    expect(value).toBe(applicationReference)
    expect(value).toMatch(/^AP[A-Z0-9]+$/)
    expect(value).not.toBe(createdId)
    expect(value).not.toMatch(UUID_RE)

    // The page caption is driven by the same reference and must not regress
    // to the GUID either.
    const caption = await detail.getCaption()
    expect(caption).toBe(applicationReference)
    expect(caption).not.toContain(createdId)

    await login.logout()
  })
})
