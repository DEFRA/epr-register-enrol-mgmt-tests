import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import {
  GLOBAL_GLASS_EXPORTS_ORG_NAME,
  GLOBAL_GLASS_EXPORTS_MATERIAL_LABEL
} from '../support/ra-412-seed.js'

/**
 * RA-412 — Work items list mislabels every Exporter application as
 * "Reprocessor".
 *
 * Root cause (see the ticket): management-fe hard-coded the literal
 * "Reprocessor" in every card instead of reading the real
 * `payload.wasteProcessingType` field that RA-314 already writes into every
 * submitted work item. The same stub `typeId` also meant the "Applicant
 * type: Exporter" filter matched nothing, however many genuine Exporter
 * applications existed.
 *
 * This spec exercises both fixes against the genuine Exporter application
 * seeded by management-be (management-be#118, `ra-412-seed.js`). It is
 * deliberately NOT a fresh fixture built via "Create work item": that form
 * has no operator-type field, so every item it creates carries no
 * `wasteProcessingType` and can only ever prove the pre-RA-314 fallback
 * ("Reprocessor") — already covered incidentally by every other spec that
 * creates a work item through the UI (e.g. ra-370-card-field-order.e2e.js).
 * Only a seeded Exporter fixture can prove the positive case this ticket
 * fixes, so the "returns a Reprocessor item unaffected" side of the filter
 * assertion below uses a fresh UI-created item as the negative control.
 *
 * Filter wiring (confirmed against management-fe#179 / management-be#118):
 * the "Applicant type" Exporter checkbox still posts `typeId=exporter`
 * (unchanged selector — `workItems.checkType('exporter')`); management-fe
 * maps that onto BOTH `typeIds: ['re-accreditation']` (there is no real
 * `exporter` typeId) AND the new `wasteProcessingTypes: ['Exporter']` param,
 * which management-be matches against `payload.wasteProcessingType`.
 *
 * Known, deliberately uncovered gap: nothing here asserts a card still reads
 * "Reprocessor" for a work item whose payload carries an EXPLICIT
 * `wasteProcessingType: "reprocessor"` (as opposed to the field being
 * absent). No such fixture is seeded in this stack — every currently-seeded
 * item is either flagged "exporter" or omits the field entirely — so that
 * regression case (an implementation that treats any non-empty value as
 * Exporter) cannot be reached through the UI. Tracked for whoever adds a
 * matching management-be fixture.
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
      await workItems.searchByOrgName(GLOBAL_GLASS_EXPORTS_ORG_NAME)
      // Bounding check: prove exactly one row matched before trusting
      // "first" to mean "the seeded fixture" (mirrors
      // ra-295-list-registration-number.e2e.js).
      expect(await workItems.getTileCount()).toBe(1)
      itemId = await workItems.firstResultWorkItemId()
    })

    it('shows "Exporter" as the applicant type, not the hard-coded "Reprocessor"', async () => {
      await expect(workItems.tileField(itemId, 'applicant-type')).toHaveText(
        'Exporter'
      )
    })

    it('renders the exact card title with the real applicant type', async () => {
      await expect(workItems.tileTitle(itemId)).toHaveText(
        `${GLOBAL_GLASS_EXPORTS_MATERIAL_LABEL} reaccreditation (Exporter)`
      )
    })
  })

  describe('Applicant type filter', () => {
    let exporterId
    let reprocessorId

    before(async () => {
      // Positive fixture: the genuine seeded Exporter application.
      await workItems.resetFilters()
      await workItems.searchByOrgName(GLOBAL_GLASS_EXPORTS_ORG_NAME)
      expect(await workItems.getTileCount()).toBe(1)
      exporterId = await workItems.firstResultWorkItemId()

      // Negative control: a fresh UI-created item. The create form has no
      // operator-type field, so this carries no wasteProcessingType at all
      // and falls back to "Reprocessor" — it must be EXCLUDED from an
      // Exporter-only result set. Proves the filter actually discriminates,
      // rather than merely proving the seeded item is reachable some other
      // way (e.g. if Exporter selection silently dropped the type
      // constraint and returned everything).
      await workItems.goto()
      ;({ id: reprocessorId } = await workItems.createWorkItem({
        organisationName: `RA412 Reprocessor Control ${Date.now()}`,
        siteAddressLine1: '1 Applicant Type Way',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 9AF',
        material: 'plastic',
        tonnageBand: '0-500'
      }))
    })

    it('Exporter option returns the genuine Exporter application and excludes a Reprocessor one', async () => {
      await workItems.resetFilters()
      await workItems.checkType('exporter')
      await workItems.applyFilters()

      await expect(workItems.tileFor(exporterId)).toBeDisplayed()
      await expect(workItems.tileFor(reprocessorId)).not.toBeExisting()
    })
  })
})
