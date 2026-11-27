import { $$, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import {
  submitAddOverseasSiteRequest,
  submitUpdateOverseasSiteRequest
} from '../support/in-year-change-api.js'
import { uniqueOrganisationName } from '../support/unique-name.js'

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
    expect((await workItems.listedIds()).sort()).toEqual(
      [addOrsId, updateOrsId].sort()
    )
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

    expect(await workItems.listedIds()).toEqual([addOrsId])
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

    expect(await workItems.listedIds()).toEqual([updateOrsId])
    expect(await workItems.activeFilterLabels()).toContain(
      'ORS updates (detail changes)'
    )
  })

  it('shows the empty state for "Withdrawals"', async () => {
    await workItems.checkOrsManagement('withdrawals')
    await workItems.applyFilters()

    expect(await workItems.listedIds()).toEqual([])
    await expect(workItems.worklistSummary()).toHaveText(
      'No work items match your filters.'
    )
  })

  it('shows the empty state for "In-year change" with "Tonnage"', async () => {
    await workItems.checkApplicationType('in-year-change')
    await workItems.checkInYearChange('tonnage')
    await workItems.applyFilters()

    expect(await workItems.listedIds()).toEqual([])
    await expect(workItems.worklistSummary()).toHaveText(
      'No work items match your filters.'
    )
    expect(await workItems.activeFilterLabels()).toContain('Tonnage')
  })

  it('lists both again when the "Tonnage" chip is removed', async () => {
    await workItems.checkApplicationType('in-year-change')
    await workItems.checkInYearChange('tonnage')
    await workItems.applyFilters()
    expect(await workItems.listedIds()).toEqual([])

    await removeChip('Tonnage')

    expect((await workItems.listedIds()).sort()).toEqual(
      [addOrsId, updateOrsId].sort()
    )
    expect(await workItems.activeFilterLabels()).not.toContain('Tonnage')
  })

  it('widens the list as the ORS chips are removed', async () => {
    await workItems.checkApplicationType('in-year-change')
    await workItems.checkInYearChange('ors')
    await workItems.checkOrsManagement('applications')
    await workItems.applyFilters()
    expect(await workItems.listedIds()).toEqual([addOrsId])

    await removeChip('ORS applications')
    expect((await workItems.listedIds()).sort()).toEqual(
      [addOrsId, updateOrsId].sort()
    )
    expect(await workItems.activeFilterLabels()).toContain('ORS')

    await removeChip('ORS')
    expect((await workItems.listedIds()).sort()).toEqual(
      [addOrsId, updateOrsId].sort()
    )
    expect(await workItems.activeFilterLabels()).not.toContain('ORS')
  })
})
