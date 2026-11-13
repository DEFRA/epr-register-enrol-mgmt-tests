import { $$, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'
import { uniqueOrganisationName } from '../support/unique-name.js'
import { uniquePostcode } from '../support/unique-postcode.js'
import { createWorkItemViaApi } from '../support/work-item-api.js'

/**
 * RA-739. The Application type filter has an "In-year change" option. It is
 * sent to management-be as `category=in-year-change`, which lists every case
 * type in that category (add-ORS today), so the list narrows to in-year
 * change applications only.
 *
 * Applicant type is a separate dimension: it narrows by the accreditation's
 * waste processing type whatever the application type, so Exporter with
 * "In-year change" lists only the add-ORS items (all exporters), and Exporter
 * alone lists them alongside exporter re-accreditations.
 *
 * A reprocessor and an exporter re-accreditation and a two-site add-ORS
 * request share an organisation name token, so an organisation search lists
 * exactly these four.
 */
describe('RA-739 "In-year change" application type filter', () => {
  const token = uniqueOrganisationName('RA739 Filter')
  let reAccreditation
  let exporterReAccreditation
  let inYearChangeIds

  const listedIds = async () =>
    Promise.all(
      [...(await workItems.tiles())].map((tile) =>
        tile.getAttribute('data-work-item-id')
      )
    )

  before(async () => {
    reAccreditation = await createWorkItemViaApi({
      organisationNamePrefix: `${token} ReAcc`
    })
    exporterReAccreditation = await createWorkItemViaApi({
      organisationNamePrefix: `${token} Exporter ReAcc`,
      fields: (base) => {
        const { siteAddress, siteAddressPostcode, ...withoutSite } = base
        return {
          ...withoutSite,
          wasteProcessingType: 'exporter',
          companyRegisterAddressPostcode: uniquePostcode('CF10')
        }
      }
    })
    const submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: `${token} ORS`,
      siteCount: 2
    })
    inYearChangeIds = submission.workItems.map((item) => item.id)
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  beforeEach(async () => {
    // A bare landing restores the session's filters and defaults to
    // "assigned to me" (RA-299); start from an explicit empty state.
    await workItems.resetFilters()
    await workItems.searchByOrg(token)
  })

  it('lists the re-accreditation and in-year change applications unfiltered', async () => {
    expect((await listedIds()).sort()).toEqual(
      [
        reAccreditation.id,
        exporterReAccreditation.id,
        ...inYearChangeIds
      ].sort()
    )
  })

  it('offers "In-year change" as the last application type', async () => {
    await workItems.expandSection('application-type')
    const values = await Promise.all(
      [...(await $$('input[name="applicationType"]'))].map((input) =>
        input.getAttribute('value')
      )
    )
    expect(values.at(-1)).toBe('in-year-change')
  })

  it('lists only in-year change applications, with its chip and count', async () => {
    await workItems.checkApplicationType('in-year-change')
    await workItems.applyFilters()

    expect((await listedIds()).sort()).toEqual([...inYearChangeIds].sort())
    expect(await workItems.getWorkItemCount()).toBe(2)
    expect(await workItems.activeFilterLabels()).toContain('In-year change')
    await expect(workItems.filterSectionToggle('application-type')).toHaveText(
      expect.stringContaining('(1 selected)')
    )
  })

  it('lists both kinds when combined with "Re-accreditation"', async () => {
    await workItems.checkApplicationType('re-accreditation')
    await workItems.checkApplicationType('in-year-change')
    await workItems.applyFilters()

    expect((await listedIds()).sort()).toEqual(
      [
        reAccreditation.id,
        exporterReAccreditation.id,
        ...inYearChangeIds
      ].sort()
    )
  })

  it('lists only exporter in-year changes with Applicant type "Exporter"', async () => {
    await workItems.checkType('exporter')
    await workItems.checkApplicationType('in-year-change')
    await workItems.applyFilters()

    expect((await listedIds()).sort()).toEqual([...inYearChangeIds].sort())
  })

  it('lists exporter applications of every type with Applicant type "Exporter" alone', async () => {
    await workItems.checkType('exporter')
    await workItems.applyFilters()

    expect((await listedIds()).sort()).toEqual(
      [exporterReAccreditation.id, ...inYearChangeIds].sort()
    )
  })

  it('lists no in-year changes with Applicant type "Reprocessor"', async () => {
    await workItems.checkType('re-accreditation')
    await workItems.checkApplicationType('in-year-change')
    await workItems.applyFilters()

    expect(await listedIds()).toEqual([])
  })

  it('lists everything again when its chip is removed', async () => {
    await workItems.checkApplicationType('in-year-change')
    await workItems.applyFilters()
    expect(await workItems.getWorkItemCount()).toBe(2)

    await workItems.removeActiveFilter('In-year change')
    await workItems.worklistSummary().waitForDisplayed()

    await expect(workItems.tileFor(reAccreditation.id)).toBeDisplayed()
    expect(await workItems.getWorkItemCount()).toBe(4)
  })
})
