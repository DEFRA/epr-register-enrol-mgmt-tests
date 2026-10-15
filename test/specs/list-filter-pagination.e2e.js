import { $, $$, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import { uniqueOrganisationName } from '../support/unique-name.js'

/** List page size (management-fe DEFAULT_PAGE_SIZE). */
const PAGE_SIZE = 20

/**
 * Work items list — checkbox/radio filters + pagination mechanics.
 *
 * Search inputs are covered elsewhere (work-items-search.e2e.js); this spec
 * exercises the parts that were not covered:
 *   • Type / Status / Nation checkbox filters
 *   • Assignment-mode radios (Your applications / Unassigned / Specific officer)
 *   • Clear filters
 *   • Pagination (page size 20, filter-preserving hrefs)
 *   • Nation auto-default (RA-125): a single-nation user defaults the list to
 *     their nation unless filtersApplied=1 is present in the URL.
 *
 * The filter form is GET to /work-items, so applying any filter always adds
 * filtersApplied=1 to the query string and surfaces selected values as query
 * params (e.g. nation=England). Unchecked options are simply absent.
 *
 * The spec creates one more item than fits on a page, all named under one
 * unique token, and the pagination tests search by that token. That makes
 * the second page a certainty rather than a property of whatever an earlier
 * run left in the database, and keeps every count independent of it.
 */
describe('Work items list — filters and pagination', () => {
  const token = uniqueOrganisationName('Filter Pagination')
  const created = []

  before(async function () {
    // PAGE_SIZE + 1 UI creations outlast the default 60s hook timeout.
    this.timeout(5 * 60 * 1000)
    await login.login()
    for (let i = 0; i < PAGE_SIZE + 1; i++) {
      await workItems.goto()
      created.push(
        await workItems.createWorkItem({
          organisationNamePrefix: `${token} Org`,
          siteAddressLine1: '1 Filter Street',
          siteAddressTown: 'Leeds',
          material: 'glass',
          tonnageBand: '0-500'
        })
      )
    }
    await workItems.resetFilters()
  })

  after(async () => {
    await login.logout()
  })

  // ── Type / State / Regulator checkbox filters ────────────────────────────── //

  describe('type / state / regulator checkbox filters', () => {
    beforeEach(async () => {
      // RA-299: a bare landing now defaults to assigned-to-me + due-date sort
      // AND restores the session's last-applied filters, so goto() is no
      // longer a stateless "show everything" reset. These pre-RA-299 specs
      // assert against the full dataset, so submit an explicit empty filter.
      await workItems.resetFilters()
    })

    it('lists a created work item when searched by its organisation name', async () => {
      const [{ id, organisationName }] = created
      await workItems.searchByOrg(organisationName)
      await expect(workItems.workItemLink(id)).toExist()
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

    it('applying a Status filter adds the status to the URL', async function () {
      const boxes = await $$('input[name="status"]')
      if (boxes.length === 0) {
        this.skip()
        return
      }
      const value = await boxes[0].getAttribute('value')
      await workItems.checkStatus(value)
      await workItems.applyFilters()
      const url = await browser.getUrl()
      expect(url).toContain('status=')
      expect(url).toContain('filtersApplied=1')
    })

    it('reflects the active regulator filter as an active-filter tag', async () => {
      // fe's results summary is now just "Showing {start}-{end} of {total}" —
      // no filter recap — so the applied Nation filter is proven via the
      // Active-filters chip instead of the summary text.
      await workItems.checkRegulator('England')
      await workItems.applyFilters()
      const labels = await workItems.activeFilterLabels()
      expect(labels.some((l) => l.includes('England'))).toBe(true)
    })
  })

  // ── Assignment-mode radios ───────────────────────────────────────────────── //

  describe('assignment-mode radios', () => {
    beforeEach(async () => {
      await workItems.resetFilters()
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
      await workItems.resetFilters()
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
      await workItems.resetFilters()
      await workItems.searchByOrg(token)
    })

    it('renders 20 rows on the first page of a 21-item result', async () => {
      expect(await workItems.getWorkItemCount()).toBe(PAGE_SIZE + 1)
      expect(await workItems.getRowCount()).toBe(PAGE_SIZE)
    })

    it('shows a pagination control once there is more than one page', async () => {
      expect(await workItems.hasPagination()).toBe(true)
      const hrefs = await workItems.paginationHrefs()
      expect(hrefs.some((h) => h && h.includes('page=2'))).toBe(true)
    })

    it('preserves the active filters in pagination hrefs', async () => {
      // Every item above is created with the form's default nation, England.
      await workItems.checkRegulator('England')
      await workItems.applyFilters()
      const hrefs = await workItems.paginationHrefs()
      const pageLinks = hrefs.filter((h) => h && h.includes('page='))
      expect(pageLinks.length).toBeGreaterThan(0)
      expect(pageLinks.every((h) => h.includes('nation=England'))).toBe(true)
      expect(
        pageLinks.every(
          (h) =>
            new URL(h, 'http://x').searchParams.get('organisation') === token
        )
      ).toBe(true)
    })
  })

  // ── Nation auto-default for a single-nation user (RA-125) ─────────────────── //

  describe('nation auto-default for a single-nation user (RA-125)', () => {
    before(async () => {
      await login.logout()
      await login.login('Scotland')
    })

    after(async () => {
      await login.logout()
      await login.login()
    })

    it('defaults the list to the user nation on a fresh visit', async () => {
      await browser.url('/work-items')
      // RA-125 applies the single-nation default server-side: the URL is not
      // rewritten, so the observable signal is the pre-ticked Nation box and
      // the Nation active-filter chip (fe's results summary carries no filter
      // recap any more — just "Showing {start}-{end} of {total}"). RA-324
      // phase-2 shows the nation name (Scotland), not the regulator body
      // (SEPA).
      expect(
        await $('input[name="nation"][value="Scotland"]').isSelected()
      ).toBe(true)
      const labels = await workItems.activeFilterLabels()
      expect(labels.some((l) => l.includes('Scotland'))).toBe(true)
    })

    it('suppresses the nation default when filtersApplied=1 is present', async () => {
      await browser.url('/work-items?filtersApplied=1')
      // Explicit form submission with no nation ticked must NOT fall back to
      // the role-based default (RA-125).
      expect(
        await $('input[name="nation"][value="Scotland"]').isSelected()
      ).toBe(false)
      const labels = await workItems.activeFilterLabels()
      expect(labels.some((l) => l.includes('Scotland'))).toBe(false)
    })
  })
})
