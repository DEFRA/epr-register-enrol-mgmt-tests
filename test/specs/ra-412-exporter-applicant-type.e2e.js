import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import { GLOBAL_GLASS_EXPORTS } from '../support/ra-412-seed.js'

/**
 * RA-412 — Work items list mislabels every Exporter application as
 * "Reprocessor".
 *
 * Root cause (see the ticket): management-fe hard-coded the literal
 * "Reprocessor" in every card instead of reading the real
 * `payload.wasteProcessingType` field that RA-314 already writes into every
 * submitted work item. The same stub `typeId` also meant the "Applicant type:
 * Exporter" filter matched nothing, however many genuine Exporter
 * applications existed.
 *
 * This spec exercises both fixes against `GLOBAL_GLASS_EXPORTS` (org 50006),
 * a genuine Exporter org seeded by management-be with a submitted
 * application (`ra-412-seed.js`). It is deliberately NOT a fresh fixture
 * built via "Create work item": that form has no operator-type field, so
 * every item it creates carries no `wasteProcessingType` and can only ever
 * prove the pre-RA-314 fallback ("Reprocessor") — already covered
 * incidentally by every other spec that creates a work item through the UI
 * (e.g. ra-370-card-field-order.e2e.js). Only a seeded Exporter org can prove
 * the positive case this ticket fixes.
 */
describe('RA-412 — Exporter applications are labelled correctly', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('applications list card', () => {
    let itemId

    before(async () => {
      await workItems.resetFilters()
      await workItems.searchByOrgName(GLOBAL_GLASS_EXPORTS.orgName)
      itemId = await workItems.firstResultWorkItemId()
    })

    it('reads the org name from the seeded Exporter application', async () => {
      await expect(workItems.tileField(itemId, 'org-name')).toHaveText(
        expect.stringContaining(GLOBAL_GLASS_EXPORTS.orgName)
      )
    })

    it('shows "Exporter" as the applicant type, not the hard-coded "Reprocessor"', async () => {
      await expect(workItems.tileField(itemId, 'applicant-type')).toHaveText(
        'Exporter'
      )
    })

    it('renders the card title ending "(Exporter)"', async () => {
      const title = await workItems.tileTitle(itemId).getText()
      expect(title).toMatch(/\(Exporter\)$/)
    })
  })

  describe('Applicant type filter', () => {
    it('Exporter now returns the genuine Exporter application', async () => {
      await workItems.resetFilters()
      await workItems.searchByOrgName(GLOBAL_GLASS_EXPORTS.orgName)
      await workItems.checkType('exporter')
      await workItems.applyFilters()

      const itemId = await workItems.firstResultWorkItemId()
      await expect(workItems.tileFor(itemId)).toBeDisplayed()
      await expect(workItems.tileField(itemId, 'org-name')).toHaveText(
        expect.stringContaining(GLOBAL_GLASS_EXPORTS.orgName)
      )
    })
  })
})
