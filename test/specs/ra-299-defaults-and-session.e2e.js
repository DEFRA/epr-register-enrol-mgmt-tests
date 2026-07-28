import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-299 — default sort, default assignee, and filter session persistence.
 *
 * Three of the five real gaps found in the RA-299 scoping audit against the
 * RA-324 phase-2 filter overhaul (see epr-87um):
 *
 *  - AC06: a bare `/work-items` landing (no query params) sorts due-soonest
 *    first without the user picking Sort by Due date. This is a server-side
 *    default (sort=due-date is applied but never appears in the URL or as a
 *    "Sorted by" active-filter chip) — a form submission with the sort left
 *    unpicked (?filtersApplied=1) is a genuinely different, explicit request
 *    and falls back to the (unsorted / newest-first) backend default instead.
 *  - AC08/09: a bare `/work-items` landing likewise defaults assigneeMode to
 *    "mine" (no assigneeMode param/chip), showing only work items assigned to
 *    the signed-in user. An explicit empty submission (?filtersApplied=1,
 *    nothing ticked) shows all applications regardless of assignee.
 *  - AC10/14: applied filters persist in the yar session and are restored on
 *    a bare `/work-items` landing reached via the "Work items" nav link
 *    within the SAME session; a brand-new session (fresh login — the stub
 *    login now calls yar.reset()) does not carry them over and falls back to
 *    the AC06/AC08 defaults above.
 *
 * The distinguishing signal for "bare landing" vs "explicit submission" is
 * purely whether the URL carries ANY query string at all (confirmed by fe,
 * management-fe PR #129) — so bare-landing assertions below deliberately
 * avoid bounding by search/organisation (a query param would itself make the
 * request "explicit" and suppress the defaults under test).
 */

const token = `Defaults${Date.now()}`

const createItem = (organisationName, postcode) =>
  workItems.goto().then(() =>
    workItems.createWorkItem({
      organisationName,
      siteAddressLine1: '1 Defaults Way',
      siteAddressTown: 'London',
      siteAddressPostcode: postcode,
      material: 'plastic',
      tonnageBand: '0-500'
    })
  )

describe('RA-299 — default sort, default assignee, session persistence', () => {
  // ── AC06: default sort ─────────────────────────────────────────────────── //

  describe('default sort (AC06)', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('sorts due-date-ascending on a bare visit, without a sort param or chip', async () => {
      await workItems.goto()
      expect(await browser.getUrl()).not.toContain('sort=')
      const labels = await workItems.activeFilterLabels()
      expect(labels.some((l) => l.startsWith('Sorted by'))).toBe(false)
      // The pre-checked radio reflects the order actually applied server-side.
      expect(await $('[data-testid="filter-sort-due-date"]').isSelected()).toBe(
        true
      )
    })

    it('does not apply the due-date default on an explicit empty submission', async () => {
      await workItems.open('/work-items?filtersApplied=1')
      await workItems.worklistSummary().waitForDisplayed()
      expect(await $('[data-testid="filter-sort-due-date"]').isSelected()).toBe(
        false
      )
      const labels = await workItems.activeFilterLabels()
      expect(labels.some((l) => l.startsWith('Sorted by'))).toBe(false)
    })
  })

  // ── AC08/09: default assignee ──────────────────────────────────────────── //

  describe('default assignee (AC08/09)', () => {
    let mine
    let other

    before(async () => {
      await login.login()
      mine = await createItem(`${token} Mine`, 'SW1A 9AE')
      other = await createItem(`${token} Other`, 'SW1A 9AF')
      // Self-assign `mine` to the signed-in user so the default-assignee
      // filter has something concrete to include; `other` is left
      // unassigned so it has something concrete to exclude.
      await workItems.openWorkItem(mine.id)
      await $('[data-testid="self-assign-submit"]').click()
      await detail.assertAssignedTo('Stub Caseworker One')
    })

    after(async () => {
      await login.logout()
    })

    it('a bare visit applies the same filtering as explicit assigneeMode=mine, without a param or chip', async () => {
      await workItems.goto()
      expect(await browser.getUrl()).not.toContain('assigneeMode=')
      const labels = await workItems.activeFilterLabels()
      expect(labels.some((l) => l.includes('Your applications'))).toBe(false)
      const bareCount = await workItems.getWorkItemCount()

      await workItems.open('/work-items?assigneeMode=mine&filtersApplied=1')
      await workItems.worklistSummary().waitForDisplayed()
      const explicitMineCount = await workItems.getWorkItemCount()

      expect(bareCount).toEqual(explicitMineCount)
    })

    it('clearing the assignee filter (explicit empty submission) shows all applications', async () => {
      await workItems.goto()
      const bareCount = await workItems.getWorkItemCount()

      await workItems.open('/work-items?filtersApplied=1')
      await workItems.worklistSummary().waitForDisplayed()
      const explicitAnyCount = await workItems.getWorkItemCount()

      // `other` is unassigned, so it inflates the "any" total but not the
      // "mine" default — a deterministic, non-flaky lower bound on the gap.
      expect(explicitAnyCount).toBeGreaterThan(bareCount)
    })

    it('content-level proof, bounded by our own two items: mine shows only the self-assigned one, clearing shows both', async () => {
      await workItems.goto()
      await workItems.searchByOrg(token)
      // organisation= alone is an explicit, unbounded-assignee submission —
      // both items show.
      await expect(workItems.tileFor(mine.id)).toBeDisplayed()
      await expect(workItems.tileFor(other.id)).toBeDisplayed()

      await workItems.setAssignmentMode('mine')
      await workItems.applyFilters()
      await expect(workItems.tileFor(mine.id)).toBeDisplayed()
      await expect(workItems.tileFor(other.id)).not.toExist()
    })
  })

  // ── AC10/14: session persistence ───────────────────────────────────────── //

  describe('filter session persistence (AC10/14)', () => {
    let item

    before(async () => {
      await login.login()
      item = await createItem(`${token} Session`, 'SW1A 9AG')
      // Self-assign: a bare landing pre-checks the AC08 "mine" assignee
      // default, and searchByOrg below submits the whole form (including
      // that pre-checked radio) — an unassigned item would be excluded by
      // it, unrelated to the session-persistence behaviour this test is
      // actually proving.
      await workItems.openWorkItem(item.id)
      await $('[data-testid="self-assign-submit"]').click()
      await detail.assertAssignedTo('Stub Caseworker One')
    })

    after(async () => {
      await login.logout()
    })

    it('restores a previously applied filter on a bare landing reached via the nav link, within the same session', async () => {
      await workItems.goto()
      await workItems.searchByOrg(token)
      expect(await browser.getUrl()).toContain('organisation=')
      await expect(workItems.tileFor(item.id)).toBeDisplayed()

      // Navigate away into the work item's own detail page, then back via
      // the bare "Work items" nav link (no query string) in the SAME
      // session.
      await workItems.openWorkItem(item.id)
      await workItems.navWorkItemsLink().click()
      await browser.waitUntil(
        async () => new URL(await browser.getUrl()).pathname === '/work-items',
        { timeout: 10000, timeoutMsg: 'Expected to land back on /work-items' }
      )
      expect(await browser.getUrl()).not.toContain('?')

      // The previously applied organisation filter is still in effect,
      // restored from the session — reflected in both the re-populated
      // search field and the still-filtered results.
      await expect(
        $('[data-testid="work-items-filter-org-search"]')
      ).toHaveValue(token)
      await expect(workItems.tileFor(item.id)).toBeDisplayed()
    })

    it('does not carry filters into a brand-new session — falls back to the AC06/AC08 defaults', async () => {
      // Re-authenticating resets the yar session (mirrors the real OAuth
      // callback), so this is a genuinely new session for the same user.
      await login.logout()
      await login.login()

      await workItems.goto()
      expect(await browser.getUrl()).not.toContain('?')
      await expect(
        $('[data-testid="work-items-filter-org-search"]')
      ).toHaveValue('')
      // Falls back to the AC06 default sort and AC08 default assignee, not
      // the previous session's organisation filter.
      expect(await $('[data-testid="filter-sort-due-date"]').isSelected()).toBe(
        true
      )
      const labels = await workItems.activeFilterLabels()
      expect(labels.some((l) => l.includes(token))).toBe(false)
    })
  })
})
