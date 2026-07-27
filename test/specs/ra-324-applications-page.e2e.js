import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems, { TILE_FIELD_ORDER } from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import query from '../page-objects/query.page.js'

/**
 * RA-324 — Applications page.
 *
 * The case-management "Work items" list was redesigned into a
 * constrained-width "Applications" page of one card/tile per application,
 * each carrying a status badge. The route is unchanged (/work-items) and the
 * H1 now reads "Applications"; the nav LINK that reaches the page stays
 * labelled "Work items" (AC01). The backend renamed the state DisplayNames
 * the badges show (submitted→"Not started", assessment-in-progress→"Updated",
 * approved→"Granted", rejected→"Refused").
 *
 * Tile hooks (from management-fe): each tile is an
 * <article data-testid="application-tile" data-work-item-id="{id}">. Inside
 * it the application-reference link is data-testid="work-item-link-{id}", the
 * status badge is data-testid="work-item-state-tag-{id}", and the remaining
 * fields carry generic testids: applicant-type + material (the "Reprocessor
 * reaccreditation: {Material}" title), org-name + org-id (the "{Org} ({Org ID})"
 * line), and — only once the SLA clock has started — assigned-to + due-on (the
 * card footer). Phase-2 removed submitted-on from the card and renamed
 * due-date to due-on.
 *
 * The terminal-state badges "Granted" (approved) and "Refused" (rejected) are
 * proven on the archived tile list by ra-224-archived-items.e2e.js, so this
 * spec drives the cheaper non-terminal states (Not started, Duly made,
 * Updated, Queried) to keep the run fast without leaving the badge ACs
 * unproven.
 */

const uniqueOrg = (label) => `${label} ${Date.now()}`

/**
 * Create a fresh (Submitted / "Not started") re-accreditation work item and
 * return its id. Navigates to the Applications list first because the
 * "Create work item" link only renders there — createWorkItem leaves the
 * browser on the new item's detail page, so a caller creating a second item
 * without this goto would have no create link to click. Each caller passes a
 * distinct postcode so ApplicationReferenceGenerator does not exhaust its
 * collision-retry budget on items that share postcode + material.
 */
async function createFreshItem(organisationName, postcode) {
  await workItems.goto()
  const { id } = await workItems.createWorkItem({
    organisationName,
    siteAddressLine1: '1 Applications Way',
    siteAddressTown: 'London',
    siteAddressPostcode: postcode,
    material: 'plastic',
    tonnageBand: '0-500'
  })
  return id
}

/**
 * Submitted → Duly made. Completing the two submitted-state tasks fires the
 * auto-duly-made hook, which starts the SLA clock (so the card's SLA footer,
 * with Due on and Assigned to, appears).
 */
async function driveToDulyMade(id) {
  await workItems.openWorkItem(id)
  await detail.gotoTasks()
  await detail.setTaskStatus('verify-organisation-details', 'Completed')
  await detail.setTaskStatus('confirm-application-completeness', 'Completed')
  await detail.gotoDetail()
  await detail.assertState('Duly made')
}

/** Duly made → Updated (assessment-in-progress) via payment-received. */
async function driveToUpdated(id) {
  await workItems.openWorkItem(id)
  await detail.gotoTasks()
  await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
  await detail.gotoDetail()
  await detail.triggerAction('payment-received')
  await detail.assertState('Updated')
}

describe('RA-324 Applications page', () => {
  // ── AC01/AC02/AC03 — navigation ──────────────────────────────────────────── //

  describe('AC01/AC02/AC03 — navigation is present and persists', () => {
    let itemId

    before(async () => {
      await login.login()
      itemId = await createFreshItem(
        uniqueOrg('Nav Applications Ltd'),
        'SW1A 3AA'
      )
      await workItems.goto()
    })

    after(async () => {
      await login.logout()
    })

    it('AC01: shows a "Work items" nav link and a "Sign out" option, and the Applications heading', async () => {
      await expect($('[data-testid="app-heading-title"]')).toHaveText(
        'Applications'
      )
      await expect(workItems.navWorkItemsLink()).toBeDisplayed()
      await expect(workItems.navWorkItemsLink()).toHaveText(
        expect.stringContaining('Work items')
      )
      await expect(workItems.navSignOut()).toBeDisplayed()
    })

    it('AC03: nav stays available on an individual work-item page', async () => {
      await workItems.openWorkItem(itemId)
      await expect(detail.navWorkItemsLink()).toBeDisplayed()
      await expect(detail.navSignOut()).toBeDisplayed()
    })

    it('AC02: clicking "Work items" lands on the Applications view', async () => {
      await workItems.openWorkItem(itemId)
      await detail.navWorkItemsLink().click()
      await browser.waitUntil(
        async () => new URL(await browser.getUrl()).pathname === '/work-items',
        { timeoutMsg: 'Expected the Work items nav link to reach /work-items' }
      )
      await expect($('[data-testid="app-heading-title"]')).toHaveText(
        'Applications'
      )
    })
  })

  // ── AC04/AC05/AC06 — tiles, field order, and the Not started badge ───────── //

  describe('AC04/AC05/AC06 — tiles, fields and the Not started badge', () => {
    const token = uniqueOrg('AC04Tiles')
    let itemId
    let otherId

    before(async () => {
      await login.login()
      // Two fresh items under a shared token so the token search yields more
      // than one tile (AC04) while staying pagination-safe.
      itemId = await createFreshItem(`${token} One`, 'SW1A 4AA')
      otherId = await createFreshItem(`${token} Two`, 'SW1A 4AB')
      await workItems.goto()
      await workItems.searchByOrgName(token)
    })

    after(async () => {
      await login.logout()
    })

    it('AC04: renders more than one application tile sharing a consistent structure', async () => {
      expect(await workItems.getTileCount()).toBeGreaterThan(1)
      const tiles = await workItems.tiles()
      for (const tile of tiles) {
        await expect(tile.$('[data-testid^="work-item-link-"]')).toBeExisting()
        await expect(
          tile.$('[data-testid^="work-item-state-tag-"]')
        ).toBeExisting()
        await expect(tile.$('[data-testid="org-name"]')).toBeExisting()
      }
    })

    it('AC05: shows the tile fields in the defined order', async () => {
      const order = await workItems.tileFieldOrder(itemId)
      // The present fields must appear in the canonical order (their indices
      // into TILE_FIELD_ORDER increase monotonically), tolerating conditional
      // fields being absent.
      const indices = order.map((field) => TILE_FIELD_ORDER.indexOf(field))
      expect(indices).toEqual([...indices].sort((a, b) => a - b))
      // The always-present fields must be there in the right relative order.
      expect(order).toContain('application-ref')
      expect(order).toContain('applicant-type')
      expect(order).toContain('material')
      expect(order).toContain('org-name')
    })

    it('AC05: omits the SLA footer (Due on / Assigned to) while the SLA clock has not started', async () => {
      // Guard first: tileHasField chains isExisting() off the tile, so an
      // absent tile would report the field absent and pass this AC05
      // conditional-display rule vacuously. Assert the tile is on the page so
      // an absent tile fails loudly instead.
      await expect(workItems.tileFor(itemId)).toBeDisplayed()
      // Phase-2: due-on and assigned-to live in the card footer, which only
      // renders once the SLA clock starts. A brand-new item shows neither, and
      // submitted-on was removed from the card entirely.
      expect(await workItems.tileHasField(itemId, 'due-on')).toBe(false)
      expect(await workItems.tileHasField(itemId, 'assigned-to')).toBe(false)
      expect(await workItems.tileHasField(itemId, 'submitted-on')).toBe(false)
    })

    it('AC06: shows the status as a "Not started" badge in the tile', async () => {
      await expect(workItems.tileStatusBadge(itemId)).toHaveText(
        expect.stringContaining('Not started')
      )
    })

    it('AC06: every rendered tile carries a status badge (consistent)', async () => {
      const tiles = await workItems.tiles()
      for (const tile of tiles) {
        await expect(
          tile.$('[data-testid^="work-item-state-tag-"]')
        ).toBeDisplayed()
      }
      // The Due on field must be absent on a brand-new item (SLA clock not
      // started) — the negative for AC05's conditional rule cross-checked at
      // the list level. Guard the tile is present first so an absent tile
      // cannot pass this vacuously.
      await expect(workItems.tileFor(otherId)).toBeDisplayed()
      expect(await workItems.tileHasField(otherId, 'due-on')).toBe(false)
    })
  })

  // ── AC05/AC07/AC08 — SLA-started tile and lifecycle badges ───────────────── //

  describe('AC05/AC07/AC08 — SLA-started tile fields and lifecycle badges', () => {
    const org = uniqueOrg('Lifecycle Applications Ltd')
    let itemId

    before(async () => {
      await login.login()
      itemId = await createFreshItem(org, 'SW1A 5AA')
      await driveToDulyMade(itemId)
    })

    after(async () => {
      await login.logout()
    })

    it('AC08: shows a "Duly made" badge once the item is duly made', async () => {
      await workItems.goto()
      await workItems.searchByOrgName(org)
      await expect(workItems.tileStatusBadge(itemId)).toHaveText(
        expect.stringContaining('Duly made')
      )
    })

    it('AC05: shows the SLA footer with Due on and Assigned to once the SLA clock has started', async () => {
      // Self-contained: navigate to the item's tile in this test's own body
      // rather than relying on page state left by the preceding AC08 test
      // (which would couple the two and let a reorder / .only / an AC08 abort
      // read a stale page).
      await workItems.goto()
      await workItems.searchByOrgName(org)
      await expect(workItems.tileFor(itemId)).toBeDisplayed()
      // Footer present once the SLA clock started: Due on + Assigned to.
      expect(await workItems.tileHasField(itemId, 'due-on')).toBe(true)
      expect(await workItems.tileHasField(itemId, 'assigned-to')).toBe(true)
      // submitted-on was removed from the card entirely in phase-2.
      expect(await workItems.tileHasField(itemId, 'submitted-on')).toBe(false)
    })

    it('AC05: shows "Unassigned" in the footer for an unassigned SLA-started item', async () => {
      await workItems.goto()
      await workItems.searchByOrgName(org)
      await expect(workItems.tileField(itemId, 'assigned-to')).toHaveText(
        expect.stringContaining('Unassigned')
      )
    })

    it('AC07: shows an "Updated" badge in assessment-in-progress', async () => {
      await driveToUpdated(itemId)
      await workItems.goto()
      await workItems.searchByOrgName(org)
      await expect(workItems.tileStatusBadge(itemId)).toHaveText(
        expect.stringContaining('Updated')
      )
    })
  })

  // ── AC06 — Queried badge ─────────────────────────────────────────────────── //

  describe('AC06 — Queried badge', () => {
    const org = uniqueOrg('Queried Applications Ltd')
    let itemId

    before(async () => {
      await login.login()
      itemId = await createFreshItem(org, 'SW1A 6AA')
      await query.gotoFor(itemId)
      await query.selectSection('business-plan')
      await query.fillReason(
        'Please clarify the submitted business plan figures.'
      )
      await query.submit()
      await query.waitForDetailUrl(itemId)
      await detail.assertState('Queried')
    })

    after(async () => {
      await login.logout()
    })

    it('shows a "Queried" badge in the tile once the application is queried', async () => {
      await workItems.goto()
      await workItems.searchByOrgName(org)
      await expect(workItems.tileStatusBadge(itemId)).toHaveText(
        expect.stringContaining('Queried')
      )
    })
  })

  // ── AC09 — audit-log history link ────────────────────────────────────────── //

  describe('AC09 — audit-log history link', () => {
    let itemId

    before(async () => {
      await login.login()
      itemId = await createFreshItem(
        uniqueOrg('Audit Applications Ltd'),
        'SW1A 7AA'
      )
    })

    after(async () => {
      await login.logout()
    })

    it('offers the audit-log history link on the work-item page', async () => {
      await workItems.openWorkItem(itemId)
      const link = $('[data-testid="work-item-audit-log-link"]')
      await expect(link).toBeDisplayed()
      await expect(link).toHaveText(expect.stringContaining('View audit log'))
    })

    it('navigates to the activity history when the link is used', async () => {
      await workItems.openWorkItem(itemId)
      await detail.gotoAudit()
      expect(await browser.getUrl()).toContain(
        `/work-items/${itemId}/audit-log`
      )
      await expect($('[data-testid="work-item-audit-log"]')).toBeDisplayed()
    })
  })

  // ── AC10 — page is usable and does not scroll horizontally ───────────────── //

  describe('AC10 — readable at a normal viewport with no horizontal scroll', () => {
    before(async () => {
      await login.login()
      // Ensure the list is non-empty so there is a tile to measure against.
      await createFreshItem(uniqueOrg('Viewport Applications Ltd'), 'SW1A 8AA')
      await browser.setWindowSize(1280, 900)
      await workItems.goto()
    })

    after(async () => {
      await login.logout()
    })

    it('renders the heading and at least one tile', async () => {
      await expect($('[data-testid="app-heading-title"]')).toBeDisplayed()
      expect(await workItems.getTileCount()).toBeGreaterThan(0)
    })

    it('does not overflow the viewport horizontally', async () => {
      const overflows = await browser.execute(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      )
      expect(overflows).toBe(false)
    })
  })
})
