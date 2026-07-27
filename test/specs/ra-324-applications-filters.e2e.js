import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-324 phase-2 — Applications filter/sort overhaul.
 *
 * The filter sidebar became native <details> collapsible sections (Sort by,
 * Type, Nation, Material, Assignment, Status, Organisation), collapsed by
 * default and auto-opened when they hold a selection. Applied filters surface
 * as an "Active filters" block of removable tags plus a "Clear all filters"
 * link; sort is one of those tags ("Sorted by: …") so the default order can be
 * restored without JavaScript. The Organisation input is a combined
 * name-or-ID search; Registration ID search was removed.
 *
 * Selectors/params verified against the shipped management-fe template + be
 * endpoint on branch ra-324-applications-page (browser-facing params: sort,
 * typeId, nation, material, status, assigneeMode, organisation).
 */

const token = `AppFilters${Date.now()}`

const createItem = (organisationName, postcode, material) =>
  workItems.goto().then(() =>
    workItems.createWorkItem({
      organisationName,
      siteAddressLine1: '1 Filter Way',
      siteAddressTown: 'London',
      siteAddressPostcode: postcode,
      material,
      tonnageBand: '0-500'
    })
  )

/** Submitted → Duly made (starts the SLA clock, so the card gets a Due on). */
async function driveToDulyMade(id) {
  await workItems.openWorkItem(id)
  await detail.gotoTasks()
  await detail.setTaskStatus('verify-organisation-details', 'Completed')
  await detail.setTaskStatus('confirm-application-completeness', 'Completed')
  await detail.gotoDetail()
  await detail.assertState('Duly made')
}

describe('RA-324 phase-2 Applications filters and sort', () => {
  // A "Not started" glass item (no SLA) and a "Duly made" plastic item (SLA
  // started) under a shared token, so facet/sort assertions can be bounded to
  // exactly these two and stay pagination-safe.
  let glass
  let plastic

  before(async () => {
    await login.login()
    glass = await createItem(`${token} Glass`, 'SW1A 9AA', 'glass')
    plastic = await createItem(`${token} Plastic`, 'SW1A 9AB', 'plastic')
    await driveToDulyMade(plastic.id)
  })

  after(async () => {
    await login.logout()
  })

  // ── Collapsible filter sections ──────────────────────────────────────────── //

  describe('collapsible filter sections', () => {
    it('a section with no selection is collapsed by default and expands on toggle', async () => {
      await workItems.goto()
      expect(await workItems.isSectionOpen('type')).toBe(false)
      await workItems.expandSection('type')
      expect(await workItems.isSectionOpen('type')).toBe(true)
    })

    it('an expanded section collapses again when toggled', async () => {
      await workItems.goto()
      await workItems.expandSection('material')
      expect(await workItems.isSectionOpen('material')).toBe(true)
      await workItems.filterSectionToggle('material').click()
      await browser.waitUntil(
        async () => !(await workItems.isSectionOpen('material')),
        {
          timeout: 5000,
          timeoutMsg: 'Expected the material section to collapse'
        }
      )
      expect(await workItems.isSectionOpen('material')).toBe(false)
    })
  })

  // ── Active filters: individual removal + clear all ───────────────────────── //

  describe('active filters block', () => {
    it('shows a removable tag for each applied filter', async () => {
      await workItems.goto()
      await workItems.checkRegulator('England')
      await workItems.checkStatus('submitted')
      await workItems.applyFilters()

      await expect(workItems.activeFilters()).toBeDisplayed()
      const labels = await workItems.activeFilterLabels()
      expect(labels.some((l) => l.includes('Nation: England'))).toBe(true)
      expect(labels.some((l) => l.includes('Status: Not started'))).toBe(true)
    })

    it('removing one active filter keeps the rest', async () => {
      await workItems.goto()
      await workItems.checkRegulator('England')
      await workItems.checkStatus('submitted')
      await workItems.applyFilters()

      await workItems.removeActiveFilter('Nation: England')
      await browser.waitUntil(
        async () => !(await browser.getUrl()).includes('nation=England'),
        {
          timeout: 10000,
          timeoutMsg: 'Expected the Nation filter to be removed'
        }
      )

      const labels = await workItems.activeFilterLabels()
      expect(labels.some((l) => l.includes('Nation'))).toBe(false)
      expect(labels.some((l) => l.includes('Status: Not started'))).toBe(true)
      expect(await browser.getUrl()).toContain('status=submitted')
    })

    it('clear all filters resets to the unfiltered list', async () => {
      await workItems.goto()
      await workItems.checkRegulator('England')
      await workItems.applyFilters()
      await expect(workItems.activeFilters()).toBeDisplayed()

      await workItems.clearAllFilters()
      await browser.waitUntil(
        async () => !(await browser.getUrl()).includes('nation=England'),
        { timeout: 10000, timeoutMsg: 'Expected all filters to be cleared' }
      )
      await expect(workItems.activeFilters()).not.toBeExisting()
    })
  })

  // ── Sort ─────────────────────────────────────────────────────────────────── //

  describe('sort', () => {
    it('surfaces a removable "Sorted by" tag and sets the sort in the URL', async () => {
      await workItems.goto()
      await workItems.selectSort('organisation')
      expect(await browser.getUrl()).toContain('sort=organisation')
      const labels = await workItems.activeFilterLabels()
      expect(labels.some((l) => l.startsWith('Sorted by'))).toBe(true)
    })

    it('removing the "Sorted by" tag restores the default order', async () => {
      await workItems.goto()
      await workItems.selectSort('organisation')
      await workItems.removeActiveFilter('Sorted by')
      await browser.waitUntil(
        async () => !(await browser.getUrl()).includes('sort=organisation'),
        { timeout: 10000, timeoutMsg: 'Expected the sort to be removed' }
      )
      expect(await browser.getUrl()).not.toContain('sort=')
    })

    it('sorting by due date orders SLA-started items before items with no SLA date', async () => {
      await workItems.goto()
      await workItems.searchByOrg(token)
      await workItems.selectSort('due-date')

      const refs = await workItems.cardRefOrder()
      const slaIndex = refs.indexOf(plastic.applicationReference)
      const noSlaIndex = refs.indexOf(glass.applicationReference)
      expect(slaIndex).toBeGreaterThanOrEqual(0)
      expect(noSlaIndex).toBeGreaterThanOrEqual(0)
      // be sorts no-SLA-clock items last on due-date (both directions), so the
      // duly-made (SLA-started) item must precede the brand-new one.
      expect(slaIndex).toBeLessThan(noSlaIndex)
    })
  })

  // ── Filtering by facet ───────────────────────────────────────────────────── //

  describe('filtering by facet', () => {
    it('Type: Exporter matches nothing (no exporter data)', async () => {
      await workItems.goto()
      await workItems.checkType('exporter')
      await workItems.applyFilters()
      await expect($('[data-testid="work-items-summary"]')).toHaveText(
        expect.stringContaining('No work items match your filters')
      )
    })

    it('Type: Reprocessor reaccreditation returns applications', async () => {
      await workItems.goto()
      await workItems.checkType('re-accreditation')
      await workItems.applyFilters()
      expect(await workItems.getTileCount()).toBeGreaterThan(0)
    })

    it('Material narrows the list to the chosen material', async () => {
      await workItems.goto()
      await workItems.searchByOrg(token)
      await workItems.checkMaterial('glass')
      await workItems.applyFilters()
      await expect(workItems.tileFor(glass.id)).toBeDisplayed()
      await expect(workItems.tileFor(plastic.id)).not.toBeExisting()
    })

    it('Status narrows the list to the chosen status', async () => {
      await workItems.goto()
      await workItems.searchByOrg(token)
      await workItems.checkStatus('duly-made')
      await workItems.applyFilters()
      await expect(workItems.tileFor(plastic.id)).toBeDisplayed()
      await expect(workItems.tileFor(glass.id)).not.toBeExisting()
    })

    it('shows the empty state for a non-matching filter combination', async () => {
      await workItems.goto()
      await workItems.searchByOrg(token)
      await workItems.checkMaterial('wood')
      await workItems.applyFilters()
      await expect($('[data-testid="work-items-summary"]')).toHaveText(
        expect.stringContaining('No work items match your filters')
      )
    })
  })
})
