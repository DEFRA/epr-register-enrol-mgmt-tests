import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import { uniqueOrganisationName } from '../support/unique-name.js'
import { uniquePostcode } from '../support/unique-postcode.js'
import { createWorkItemViaApi } from '../support/work-item-api.js'

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
 * This spec exercises both fixes against a genuine Exporter application,
 * submitted through the API with `wasteProcessingType: "exporter"`
 * (`createWorkItemViaApi`). It is deliberately NOT a fixture built via
 * "Create work item": that form has no operator-type field, so every item it
 * creates carries no `wasteProcessingType` and can only ever prove the
 * pre-RA-314 fallback ("Reprocessor").
 *
 * Filter wiring (confirmed against management-fe#179 / management-be#118):
 * the "Applicant type" Exporter checkbox still posts `typeId=exporter`
 * (unchanged selector — `workItems.checkType('exporter')`); management-fe
 * maps that onto BOTH `typeIds: ['re-accreditation']` (there is no real
 * `exporter` typeId) AND the new `wasteProcessingTypes: ['Exporter']` param,
 * which management-be matches against `payload.wasteProcessingType`.
 *
 * The negative controls are two Reprocessor applications: one whose payload
 * carries an EXPLICIT `wasteProcessingType: "reprocessor"`, which catches an
 * implementation that treats any non-empty value as Exporter, and one that
 * omits the field, the pre-RA-314 shape.
 */
describe('RA-412 — Exporter applications are labelled correctly', () => {
  // One token scopes the filter assertions to this spec's three items, so
  // they hold however many other applications the list holds.
  const token = uniqueOrganisationName('RA412 Applicant Type')
  let exporterItemId
  let explicitReprocessorId
  let unflaggedReprocessorId

  before(async () => {
    await login.login()
    ;({ id: exporterItemId } = await createWorkItemViaApi({
      organisationNamePrefix: `${token} Exporter`,
      fields: (base) => {
        const { siteAddress, siteAddressPostcode, ...withoutSite } = base
        return {
          ...withoutSite,
          material: 'glass',
          wasteProcessingType: 'exporter',
          // An exporter's regulator (and the application reference's
          // postcode segment) comes from its registered office.
          companyRegisterAddressPostcode: uniquePostcode('CF10')
        }
      }
    }))
    ;({ id: explicitReprocessorId } = await createWorkItemViaApi({
      organisationNamePrefix: `${token} Explicit Reprocessor`,
      fields: { wasteProcessingType: 'reprocessor' }
    }))
    ;({ id: unflaggedReprocessorId } = await createWorkItemViaApi({
      organisationNamePrefix: `${token} Unflagged Reprocessor`
    }))
    await workItems.resetFilters()
    await workItems.searchByOrgName(token)
  })

  after(async () => {
    await login.logout()
  })

  describe('applications list card', () => {
    it('shows "Exporter" as the applicant type, not the hard-coded "Reprocessor"', async () => {
      await expect(
        workItems.tileField(exporterItemId, 'applicant-type')
      ).toHaveText('Exporter')
    })

    it('shows "Reprocessor" for an explicit reprocessor and for an unflagged one', async () => {
      await expect(
        workItems.tileField(explicitReprocessorId, 'applicant-type')
      ).toHaveText('Reprocessor')
      await expect(
        workItems.tileField(unflaggedReprocessorId, 'applicant-type')
      ).toHaveText('Reprocessor')
    })

    it('renders the exact card title with the real applicant type', async () => {
      await expect(workItems.tileTitle(exporterItemId)).toHaveText(
        // management-fe's materials.js renders the raw `glass` token as the
        // single label "Glass".
        'Glass reaccreditation (Exporter)'
      )
    })
  })

  describe('Applicant type filter', () => {
    it('Exporter option returns the genuine Exporter application and excludes both Reprocessor ones', async () => {
      await workItems.resetFilters()
      await workItems.checkType('exporter')
      await workItems.searchByOrgName(token)

      await expect(workItems.tileFor(exporterItemId)).toBeDisplayed()
      await expect(workItems.tileFor(explicitReprocessorId)).not.toBeExisting()
      await expect(workItems.tileFor(unflaggedReprocessorId)).not.toBeExisting()
    })
  })
})
