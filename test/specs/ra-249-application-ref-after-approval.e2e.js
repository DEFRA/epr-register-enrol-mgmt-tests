import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { dulyMake } from '../support/re-accreditation-journey.js'

/**
 * RA-249 — the application reference must survive approval.
 *
 * Approving a re-accreditation used to rewrite the whole stored payload
 * from a model that ignored unmodelled keys, dropping
 * `payload.applicationReference`. With the human reference gone, the
 * frontend fell back to the internal work-item GUID and rendered that as
 * the "Application ref" (and page caption) — so an approved item showed
 * e.g. `88e380d5-74ff-4c86-bd8a-a56860a3c2b5` instead of `RA-000000123`.
 *
 * This journey drives a re-accreditation all the way to Approved and then
 * asserts the "Application ref" row and the page caption still show the
 * `RA-*` reference — never a UUID.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('RA-249 — application reference survives approval', () => {
  let createdId
  let applicationReference

  it('creates a re-accreditation and drives it to awaiting-decision', async () => {
    await login.loginAs('assign')
    await workItems.goto()
    ;({ id: createdId, applicationReference } = await workItems.createWorkItem({
      organisationName: 'Persistent Reference Recyclers',
      siteAddressLine1: '1 Persistence Road',
      siteAddressTown: 'Cardiff',
      siteAddressPostcode: 'CF1 1AA',
      material: 'plastic',
      tonnageBand: '500-5000'
    }))

    // Sanity: the server-generated reference is a real RA-* ref, not the GUID.
    expect(applicationReference).toMatch(/^RA-\d{9}$/)
    expect(applicationReference).not.toBe(createdId)

    await workItems.openWorkItem(createdId)
    await detail.assertState('Submitted')

    // Submitted -> Duly made. RA-316 replaced the submitted tasks and
    // the auto-transition hook with the "Duly make" CTA and a payment
    // date; the shared helper owns that journey.
    await dulyMake(createdId)

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

  it('keeps the RA-* application ref after the decision maker approves it', async () => {
    await login.loginAs('decision-maker')
    await workItems.openWorkItem(createdId)
    await detail.assertState('Awaiting decision')

    await detail.gotoTasks()
    await detail.setTaskStatus('record-decision-rationale', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('approve')
    await detail.submitApproval()

    await detail.assertState('Approved')
    await detail.assertApprovalPanelVisible()

    // The core RA-249 assertion: the "Application ref" row must still be the
    // human RA-* reference, never the internal GUID / a UUID.
    const value = await detail.getSummaryValueByKey('Application ref')
    expect(value).toBe(applicationReference)
    expect(value).toMatch(/^RA-\d{9}$/)
    expect(value).not.toBe(createdId)
    expect(value).not.toMatch(UUID_RE)

    // The page caption is driven by the same reference and must not regress
    // to the GUID either.
    const caption = await detail.getCaption()
    expect(caption).toBe(`Work item ${applicationReference}`)
    expect(caption).not.toContain(createdId)

    await login.logout()
  })
})
