import { $, $$, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'

/**
 * Work items list — checkbox/radio filters + pagination mechanics.
 *
 * Search inputs are covered elsewhere (work-items-search.e2e.js); this spec
 * exercises the parts that were not covered:
 *   • Type / State / Regulator(nation) checkbox filters
 *   • Assignment-mode radios (Anyone / Assigned to me / Unassigned / Specific user)
 *   • Clear filters
 *   • Pagination (page size 20, filter-preserving hrefs)
 *   • Nation auto-default (RA-125): a single-nation user defaults the list to
 *     their nation unless filtersApplied=1 is present in the URL.
 *
 * The filter form is GET to /work-items, so applying any filter always adds
 * filtersApplied=1 to the query string and surfaces selected values as query
 * params (e.g. nation=England). Unchecked options are simply absent.
 */
describe('Work items list — filters and pagination', () => {
  let createdId
  const orgName = `Filter Pagination Org ${Date.now()}`

  before(async () => {
    await login.loginAs('assign')
    await workItems.goto()
    ;({ id: createdId } = await workItems.createWorkItem({
      organisationName: orgName,
      siteAddressLine1: '1 Filter Street',
      siteAddressTown: 'Leeds',
      siteAddressPostcode: 'LS1 1AA',
      material: 'glass',
      tonnageBand: '0-500'
    }))
    await workItems.goto()
  })

  after(async () => {
    await login.logout()
  })

  // ── Type / State / Regulator checkbox filters ────────────────────────────── //

  describe('type / state / regulator checkbox filters', () => {
    beforeEach(async () => {
      await workItems.goto()
    })

    it('lists the seeded work item on the unfiltered list', async () => {
      await expect(workItems.workItemLink(createdId)).toExist()
    })

    it('applying a regulator filter adds nation and filtersApplied to the URL', async () => {
      await workItems.checkRegulator('England')
      await workItems.applyFilters()
      const url = await browser.getUrl()
      expect(url).toContain('nation=England')
      expect(url).toContain('filtersApplied=1')
    })

    it('applying a Type filter adds the typeId to the URL', async function () {
      const boxes = await $$('input[name="typeId"]')
      if (boxes.length === 0) {
        this.skip()
        return
      }
      const value = await boxes[0].getAttribute('value')
      await workItems.checkType(value)
      await workItems.applyFilters()
      const url = await browser.getUrl()
      expect(url).toContain('typeId=')
      expect(url).toContain('filtersApplied=1')
    })

    it('applying a State filter adds the stateId to the URL', async function () {
      const boxes = await $$('input[name="stateId"]')
      if (boxes.length === 0) {
        this.skip()
        return
      }
      const value = await boxes[0].getAttribute('value')
      await workItems.checkState(value)
      await workItems.applyFilters()
      const url = await browser.getUrl()
      expect(url).toContain('stateId=')
      expect(url).toContain('filtersApplied=1')
    })

    it('reflects the active regulator filter in the summary text', async () => {
      await workItems.checkRegulator('England')
      await workItems.applyFilters()
      const summary = await workItems.getSummaryText()
      expect(summary).toContain('regulator:')
    })
  })

  // ── Assignment-mode radios ───────────────────────────────────────────────── //

  describe('assignment-mode radios', () => {
    beforeEach(async () => {
      await workItems.goto()
    })

    it('"Assigned to me" sets assigneeMode=mine in the URL', async () => {
      await workItems.setAssignmentMode('mine')
      await workItems.applyFilters()
      expect(await browser.getUrl()).toContain('assigneeMode=mine')
    })

    it('"Unassigned" sets assigneeMode=unassigned in the URL', async () => {
      await workItems.setAssignmentMode('unassigned')
      await workItems.applyFilters()
      expect(await browser.getUrl()).toContain('assigneeMode=unassigned')
    })

    it('"Anyone" sets assigneeMode=any in the URL', async () => {
      await workItems.setAssignmentMode('any')
      await workItems.applyFilters()
      expect(await browser.getUrl()).toContain('assigneeMode=any')
    })

    it('"Specific user" sets assigneeMode=user and the assigneeUserId', async function () {
      const userId = await workItems.firstAssignableUserId()
      if (!userId) {
        this.skip()
        return
      }
      await workItems.selectSpecificUser(userId)
      await workItems.applyFilters()
      const url = await browser.getUrl()
      expect(url).toContain('assigneeMode=user')
      expect(url).toContain('assigneeUserId=')
    })
  })

  // ── Clear filters ────────────────────────────────────────────────────────── //

  describe('clear filters', () => {
    it('removes the active regulator filter from the URL', async () => {
      await workItems.goto()
      await workItems.checkRegulator('England')
      await workItems.applyFilters()
      expect(await browser.getUrl()).toContain('nation=England')

      await expect(workItems.clearFiltersLink()).toExist()
      await workItems.clearFilters()
      expect(await browser.getUrl()).not.toContain('nation=England')
    })
  })

  // ── Pagination (page size 20, filter-preserving hrefs) ───────────────────── //

  describe('pagination (page size 20, filter-preserving hrefs)', () => {
    beforeEach(async () => {
      await workItems.goto()
    })

    it('renders at most 20 rows per page', async () => {
      const rows = await workItems.getRowCount()
      expect(rows).toBeLessThanOrEqual(20)
    })

    it('shows a pagination control once there is more than one page', async function () {
      const total = await workItems.getWorkItemCount()
      if (total <= 20) {
        this.skip()
        return
      }
      expect(await workItems.hasPagination()).toBe(true)
      const hrefs = await workItems.paginationHrefs()
      expect(hrefs.some((h) => h && h.includes('page=2'))).toBe(true)
    })

    it('preserves the active filter in pagination hrefs', async function () {
      await workItems.checkRegulator('England')
      await workItems.applyFilters()
      if (!(await workItems.hasPagination())) {
        this.skip()
        return
      }
      const hrefs = await workItems.paginationHrefs()
      const pageLinks = hrefs.filter((h) => h && h.includes('page='))
      if (pageLinks.length === 0) {
        this.skip()
        return
      }
      expect(pageLinks.every((h) => h.includes('nation=England'))).toBe(true)
    })
  })

  // ── Nation auto-default for a single-nation user (RA-125) ─────────────────── //

  describe('nation auto-default for a single-nation user (RA-125)', () => {
    before(async () => {
      await login.logout()
      await login.loginAs('assign', 'Scotland')
    })

    after(async () => {
      await login.logout()
      await login.loginAs('assign')
    })

    it('defaults the list to the user nation on a fresh visit', async () => {
      await browser.url('/work-items')
      // RA-125 applies the single-nation default server-side: the URL is not
      // rewritten, so the observable signal is the pre-ticked regulator box
      // (Scotland -> SEPA) and the regulator line in the filter summary.
      expect(
        await $('input[name="nation"][value="Scotland"]').isSelected()
      ).toBe(true)
      expect(await workItems.getSummaryText()).toContain('SEPA')
    })

    it('suppresses the nation default when filtersApplied=1 is present', async () => {
      await browser.url('/work-items?filtersApplied=1')
      // Explicit form submission with no nation ticked must NOT fall back to
      // the role-based default (RA-125).
      expect(
        await $('input[name="nation"][value="Scotland"]').isSelected()
      ).toBe(false)
      expect(await workItems.getSummaryText()).not.toContain('SEPA')
    })
  })
})
