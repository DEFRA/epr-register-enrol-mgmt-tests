import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'

/**
 * Work items list — search filters.
 *
 * Covers the three specific search inputs added to the filter sidebar:
 *   Org ID           — matches payload.applicationReference
 *   Registration ID  — matches the work item id (application ref column)
 *   Org name         — matches payload.organisationName
 */
describe('Work items list — search filters', () => {
  let workItemId
  let applicationReference
  const orgName = `Search Test Org ${Date.now()}`

  before(async () => {
    await login.loginAs('assign')
    await workItems.goto()
    ;({ id: workItemId, applicationReference } = await workItems.createWorkItem(
      {
        organisationName: orgName,
        siteAddressLine1: '1 Search Street',
        siteAddressTown: 'Leeds',
        siteAddressPostcode: 'LS1 1AA',
        material: 'glass',
        tonnageBand: '0-500'
      }
    ))
    await workItems.goto()
  })

  after(async () => {
    await login.logout()
  })

  describe('search inputs are present in the filter form', () => {
    it('renders an Org ID input', async () => {
      await expect($('[data-testid="work-items-filter-org-id"]')).toExist()
    })

    it('renders a Registration ID input', async () => {
      await expect(
        $('[data-testid="work-items-filter-registration-id"]')
      ).toExist()
    })

    it('renders an Org name input', async () => {
      await expect($('[data-testid="work-items-filter-org-name"]')).toExist()
    })
  })

  describe('search by Org ID (applicationReference)', () => {
    afterEach(async () => {
      await workItems.goto()
    })

    it('finds the work item when the full application reference is entered', async () => {
      await workItems.searchByOrgId(applicationReference)
      await expect(workItems.workItemLink(workItemId)).toExist()
    })

    it('finds the work item when a partial application reference is entered', async () => {
      const partial = applicationReference.slice(0, 4)
      await workItems.searchByOrgId(partial)
      await expect(workItems.workItemLink(workItemId)).toExist()
    })

    it('shows no results for a non-existent org ID', async () => {
      await workItems.searchByOrgId('NONEXISTENT-ORG-ID-XYZ')
      await expect($('[data-testid="work-items-summary"]')).toHaveText(
        expect.stringContaining('No work items match your filters')
      )
    })
  })

  describe('search by Registration ID (work item id)', () => {
    afterEach(async () => {
      await workItems.goto()
    })

    it('finds the work item when the full id is entered', async () => {
      await workItems.searchByRegistrationId(workItemId)
      await expect(workItems.workItemLink(workItemId)).toExist()
    })

    it('finds the work item when a partial id prefix is entered', async () => {
      const partial = workItemId.slice(0, 8)
      await workItems.searchByRegistrationId(partial)
      await expect(workItems.workItemLink(workItemId)).toExist()
    })

    it('shows no results for a non-existent registration id', async () => {
      await workItems.searchByRegistrationId(
        '00000000-0000-0000-0000-nonexistent'
      )
      await expect($('[data-testid="work-items-summary"]')).toHaveText(
        expect.stringContaining('No work items match your filters')
      )
    })
  })

  describe('search by Org name (organisationName)', () => {
    afterEach(async () => {
      await workItems.goto()
    })

    it('finds the work item when the full org name is entered', async () => {
      await workItems.searchByOrgName(orgName)
      await expect(workItems.workItemLink(workItemId)).toExist()
    })

    it('finds the work item when a partial org name is entered', async () => {
      await workItems.searchByOrgName('Search Test Org')
      await expect(workItems.workItemLink(workItemId)).toExist()
    })

    it('is case-insensitive', async () => {
      await workItems.searchByOrgName(orgName.toLowerCase())
      await expect(workItems.workItemLink(workItemId)).toExist()
    })

    it('shows no results for a non-existent org name', async () => {
      await workItems.searchByOrgName('NONEXISTENT ORG XYZ 99999')
      await expect($('[data-testid="work-items-summary"]')).toHaveText(
        expect.stringContaining('No work items match your filters')
      )
    })
  })

  describe('filter summary reflects active search terms', () => {
    afterEach(async () => {
      await workItems.goto()
    })

    it('shows the org ID in the filter summary', async () => {
      await workItems.searchByOrgId(applicationReference)
      await expect($('[data-testid="work-items-summary"]')).toHaveText(
        expect.stringContaining(`org ID: "${applicationReference}"`)
      )
    })

    it('shows the registration ID in the filter summary', async () => {
      await workItems.searchByRegistrationId(workItemId)
      await expect($('[data-testid="work-items-summary"]')).toHaveText(
        expect.stringContaining(`registration ID: "${workItemId}"`)
      )
    })

    it('shows the org name in the filter summary', async () => {
      await workItems.searchByOrgName(orgName)
      await expect($('[data-testid="work-items-summary"]')).toHaveText(
        expect.stringContaining(`org name: "${orgName}"`)
      )
    })
  })

  describe('navigating to the work item detail from search results', () => {
    before(async () => {
      await workItems.searchByOrgName(orgName)
    })

    it('clicking the application ref link opens the work item detail', async () => {
      await workItems.workItemLink(workItemId).click()
      await expect($('[data-testid="work-item-summary"]')).toExist()
    })
  })
})
