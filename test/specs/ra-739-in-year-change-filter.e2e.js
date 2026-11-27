import { $$, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import {
  submitAddOverseasSiteRequest,
  submitUpdateOverseasSiteRequest
} from '../support/in-year-change-api.js'
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

/**
 * RA-681. The "In-year change" (Tonnage, ORS) and "ORS management"
 * (Applications, Withdrawals, Updates (detail changes)) sections narrow the
 * in-year change part of the list. management-fe sends their ticks as
 * `typeIds` in place of the `in-year-change` category, and an empty
 * Application type counts as every application type ticked.
 *
 * An add-ORS request and an ORS update request (RA-682) share an
 * organisation name token, so an organisation search lists exactly these
 * two. There is no re-accreditation in the set, so a filter that matches no
 * in-year change shows the empty state even with Application type empty.
 * Tonnage and ORS withdrawals aren't in case management yet, so their options
 * match nothing.
 */
describe('RA-681 "In-year change" and "ORS management" filters', () => {
  const token = uniqueOrganisationName('RA681 Filter')
  let addOrsId
  let updateOrsId

  const listedIds = async () =>
    Promise.all(
      [...(await workItems.tiles())].map((tile) =>
        tile.getAttribute('data-work-item-id')
      )
    )

  // Remove the chip labelled exactly `label` and wait for the list it links
  // to, so the next read sees the new page, not the old one.
  const removeChip = async (label) => {
    const before = await browser.getUrl()
    await workItems.removeActiveFilter(label, { exact: true })
    await browser.waitUntil(async () => (await browser.getUrl()) !== before, {
      timeoutMsg: `Expected removing the "${label}" chip to navigate`
    })
    await workItems.worklistSummary().waitForDisplayed()
  }

  before(async () => {
    const add = await submitAddOverseasSiteRequest({
      organisationNamePrefix: `${token} Add`,
      siteCount: 1
    })
    addOrsId = add.workItems[0].id
    const update = await submitUpdateOverseasSiteRequest({
      organisationNamePrefix: `${token} Update`,
      siteCount: 1
    })
    updateOrsId = update.workItems[0].id
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  beforeEach(async () => {
    await workItems.resetFilters()
    await workItems.searchByOrg(token)
  })

  it('lists both ORS requests unfiltered', async () => {
    expect((await listedIds()).sort()).toEqual([addOrsId, updateOrsId].sort())
  })

  it('places both sections after Application type, collapsed', async () => {
    const keys = await Promise.all(
      [...(await $$('details[data-testid^="filter-section-"]'))].map(
        (section) => section.getAttribute('data-testid')
      )
    )
    const at = (key) => keys.indexOf(`filter-section-${key}`)
    expect(at('in-year-change')).toBe(at('application-type') + 1)
    expect(at('ors-management')).toBe(at('application-type') + 2)
    expect(await workItems.isSectionOpen('in-year-change')).toBe(false)
    expect(await workItems.isSectionOpen('ors-management')).toBe(false)
  })

  it('lists only the add-ORS item for "In-year change", "ORS" and "Applications"', async () => {
    await workItems.checkApplicationType('in-year-change')
    await workItems.checkInYearChange('ors')
    await workItems.checkOrsManagement('applications')
    await workItems.applyFilters()

    expect(await listedIds()).toEqual([addOrsId])
    const labels = await workItems.activeFilterLabels()
    expect(labels).toContain('In-year change')
    expect(labels).toContain('ORS')
    expect(labels).toContain('ORS applications')
    await expect(workItems.filterSectionToggle('in-year-change')).toHaveText(
      expect.stringContaining('(1 selected)')
    )
    await expect(workItems.filterSectionToggle('ors-management')).toHaveText(
      expect.stringContaining('(1 selected)')
    )
  })

  it('lists only the update item for "Updates (detail changes)"', async () => {
    await workItems.checkOrsManagement('updates')
    await workItems.applyFilters()

    expect(await listedIds()).toEqual([updateOrsId])
    expect(await workItems.activeFilterLabels()).toContain(
      'ORS updates (detail changes)'
    )
  })

  it('shows the empty state for "Withdrawals"', async () => {
    await workItems.checkOrsManagement('withdrawals')
    await workItems.applyFilters()

    expect(await listedIds()).toEqual([])
    await expect(workItems.worklistSummary()).toHaveText(
      'No work items match your filters.'
    )
  })

  it('shows the empty state for "In-year change" with "Tonnage"', async () => {
    await workItems.checkApplicationType('in-year-change')
    await workItems.checkInYearChange('tonnage')
    await workItems.applyFilters()

    expect(await listedIds()).toEqual([])
    await expect(workItems.worklistSummary()).toHaveText(
      'No work items match your filters.'
    )
    expect(await workItems.activeFilterLabels()).toContain('Tonnage')
  })

  it('lists both again when the "Tonnage" chip is removed', async () => {
    await workItems.checkApplicationType('in-year-change')
    await workItems.checkInYearChange('tonnage')
    await workItems.applyFilters()
    expect(await listedIds()).toEqual([])

    await removeChip('Tonnage')

    expect((await listedIds()).sort()).toEqual([addOrsId, updateOrsId].sort())
    expect(await workItems.activeFilterLabels()).not.toContain('Tonnage')
  })

  it('widens the list as the ORS chips are removed', async () => {
    await workItems.checkApplicationType('in-year-change')
    await workItems.checkInYearChange('ors')
    await workItems.checkOrsManagement('applications')
    await workItems.applyFilters()
    expect(await listedIds()).toEqual([addOrsId])

    await removeChip('ORS applications')
    expect((await listedIds()).sort()).toEqual([addOrsId, updateOrsId].sort())
    expect(await workItems.activeFilterLabels()).toContain('ORS')

    await removeChip('ORS')
    expect((await listedIds()).sort()).toEqual([addOrsId, updateOrsId].sort())
    expect(await workItems.activeFilterLabels()).not.toContain('ORS')
  })
})
