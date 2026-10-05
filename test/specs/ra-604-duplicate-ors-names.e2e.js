import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  DUPLICATE_ORS,
  ORG_NAME,
  SHARED_ORS_NAME,
  UNIQUE_ORS_NAMES
} from '../support/ra-604-seed.js'

/**
 * RA-604: show condensed addresses in collapsed ORS summaries when names
 * repeat, while retaining each complete address in the expanded site details.
 *
 * Runs against management-be's `duplicate-ors-names` seed. It includes two
 * ORSs with the same name and two uniquely named ORSs on the same application.
 */
describe('RA-604 duplicate overseas reprocessing site names', () => {
  before(async () => {
    await login.login()
    await workItems.resetFilters()
    await workItems.searchByOrgName(ORG_NAME)
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('filtersApplied=1'),
      { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
    )
    expect(await workItems.getRowCount()).toBe(1)
    await workItems.openFirstListedWorkItem()
    await detail.applicationDetailRow('ors').waitForDisplayed({
      timeoutMsg:
        'the ORS row never rendered for the duplicate-name seed application'
    })
  })

  after(async () => {
    await login.logout()
  })

  it('shows condensed addresses only beside duplicate names in the collapsed summaries', async () => {
    const siteBlocks = await detail.overseasSiteBlocks()
    expect(siteBlocks).toHaveLength(4)

    const sites = await Promise.all(
      [...siteBlocks].map(async (site) => {
        const name = await site
          .$('[data-testid="overseas-site-name"]')
          .getText()
        const summaryAddress = site.$(
          '[data-testid="overseas-site-summary-address"]'
        )
        const hasSummaryAddress = await summaryAddress.isExisting()

        return {
          name,
          summaryAddress: hasSummaryAddress
            ? await summaryAddress.getText()
            : null
        }
      })
    )

    const duplicateSites = sites.filter((site) =>
      site.name.includes(SHARED_ORS_NAME)
    )
    expect(duplicateSites).toHaveLength(DUPLICATE_ORS.length)
    expect(duplicateSites.map((site) => site.summaryAddress).sort()).toEqual(
      DUPLICATE_ORS.map((site) => site.summaryAddress).sort()
    )

    for (const uniqueName of UNIQUE_ORS_NAMES) {
      const uniqueSites = sites.filter((site) => site.name.includes(uniqueName))
      expect(uniqueSites).toHaveLength(1)
      expect(uniqueSites[0].summaryAddress).toBeNull()
    }
  })

  it('retains the full address for each duplicate-name ORS when expanded', async () => {
    await detail.expandAllOverseasSiteDetails()
    const siteBlocks = await detail.overseasSiteBlocks()
    const duplicateSites = await Promise.all(
      [...siteBlocks].map(async (element) => ({
        element,
        name: await element.$('[data-testid="overseas-site-name"]').getText()
      }))
    )
    const matchingDuplicateSites = duplicateSites.filter((site) =>
      site.name.includes(SHARED_ORS_NAME)
    )
    expect(matchingDuplicateSites).toHaveLength(DUPLICATE_ORS.length)
    const expandedDuplicateAddresses = await Promise.all(
      matchingDuplicateSites.map(async ({ element }) => {
        return element.$('[data-testid="overseas-site-address"]').getText()
      })
    )
    expect(expandedDuplicateAddresses.sort()).toEqual(
      DUPLICATE_ORS.map((site) => site.fullAddress).sort()
    )
  })
})
