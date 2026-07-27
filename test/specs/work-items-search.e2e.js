import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'

/**
 * Applications list — combined "Organisation name or ID" search (RA-324 phase-2).
 *
 * The separate Org ID / Registration ID / Org name inputs were replaced by a
 * single "Organisation name or ID" field (data-testid
 * work-items-filter-org-search, param `organisation`) that matches
 * organisation name OR the operator organisation id, case-insensitively.
 * Registration-id search was removed entirely. Items created through the case
 * management UI carry no operator org id, so these tests exercise the
 * organisation-NAME matching path.
 */
describe('Applications list — organisation search', () => {
  let workItemId
  const orgName = `Search Test Org ${Date.now()}`

  before(async () => {
    await login.login()
    await workItems.goto()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: orgName,
      siteAddressLine1: '1 Search Street',
      siteAddressTown: 'Leeds',
      siteAddressPostcode: 'LS1 2AJ',
      material: 'glass',
      tonnageBand: '0-500'
    }))
    await workItems.goto()
  })

  after(async () => {
    await login.logout()
  })

  describe('the search input replaces the old separate filters', () => {
    it('renders the combined "Organisation name or ID" input', async () => {
      await workItems.expandSection('organisation')
      await expect(
        $('[data-testid="work-items-filter-org-search"]')
      ).toBeDisplayed()
    })

    it('no longer renders the removed Registration ID / Org ID / Org name inputs', async () => {
      await expect(
        $('[data-testid="work-items-filter-registration-id"]')
      ).not.toExist()
      await expect($('[data-testid="work-items-filter-org-id"]')).not.toExist()
      await expect(
        $('[data-testid="work-items-filter-org-name"]')
      ).not.toExist()
    })
  })

  describe('search by organisation name', () => {
    afterEach(async () => {
      await workItems.goto()
    })

    it('finds the work item by full organisation name', async () => {
      await workItems.searchByOrg(orgName)
      await expect(workItems.workItemLink(workItemId)).toExist()
    })

    it('finds the work item by a partial organisation name', async () => {
      await workItems.searchByOrg('Search Test Org')
      await expect(workItems.workItemLink(workItemId)).toExist()
    })

    it('is case-insensitive', async () => {
      await workItems.searchByOrg(orgName.toLowerCase())
      await expect(workItems.workItemLink(workItemId)).toExist()
    })

    it('shows no results for a non-matching search', async () => {
      await workItems.searchByOrg('NONEXISTENT ORG XYZ 99999')
      await expect($('[data-testid="work-items-summary"]')).toHaveText(
        expect.stringContaining('No work items match your filters')
      )
    })
  })

  describe('the organisation search is reflected back to the user', () => {
    afterEach(async () => {
      await workItems.goto()
    })

    it('names the organisation term in the results summary', async () => {
      await workItems.searchByOrg(orgName)
      await expect($('[data-testid="work-items-summary"]')).toHaveText(
        expect.stringContaining(`organisation: "${orgName}"`)
      )
    })

    it('shows a removable "Organisation" active-filter tag', async () => {
      await workItems.searchByOrg(orgName)
      const labels = await workItems.activeFilterLabels()
      expect(labels.some((l) => l.includes(`Organisation: ${orgName}`))).toBe(
        true
      )
    })
  })

  describe('navigating to detail from a search result', () => {
    before(async () => {
      await workItems.searchByOrg(orgName)
    })

    it('opens the work item detail when the ref link is clicked', async () => {
      await workItems.workItemLink(workItemId).click()
      await expect($('[data-testid="work-item-summary"]')).toExist()
    })
  })
})
