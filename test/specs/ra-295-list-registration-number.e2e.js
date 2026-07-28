import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'

/**
 * RA-295 (AC06) — the registration number is shown on the applications list.
 *
 * Regulators triage from the list, so the registration number has to be on the
 * card rather than only on the individual work item page. Asserted against the
 * seeded fixtures, which carry a known registration number
 * (`payload.registrationNumber`, e.g. EPR-100999) — a UI-created item has no
 * way to supply one, so it could only ever prove the em-dash fallback.
 */
describe('RA-295 registration number on the applications list', () => {
  before(async () => {
    // No nation → a multi-nation "see all" user, so the seeded items are
    // visible regardless of which nation they were seeded into.
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('a seeded application with a registration number', () => {
    before(async () => {
      // A bare landing defaults to "assigned to me" (RA-299), which would hide
      // these unassigned seeded items.
      await workItems.resetFilters()
      await workItems.searchByOrgName('Full Payload Verification Ltd')
      await browser.waitUntil(
        async () => (await browser.getUrl()).includes('filtersApplied=1'),
        { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
      )
      expect(await workItems.getRowCount()).toBe(1)
    })

    it('renders the registration number on the card', async () => {
      const id = await workItems.firstResultWorkItemId()
      expect(await workItems.tileHasRegistrationNumber(id)).toBe(true)
      await expect(workItems.tileRegistrationNumber(id)).toHaveText(
        expect.stringContaining('EPR-100999')
      )
    })
  })

  describe('across the whole list', () => {
    before(async () => {
      // Unbounded (well, unfiltered) so this reads a page of real cards rather
      // than the single card hand-picked above — the AC is about the list, and
      // a field wired up for one code path is a real failure mode.
      await workItems.resetFilters()
    })

    it('renders a registration number on every card', async () => {
      const numbers = await workItems.cardRegistrationNumbers()
      // Guard against a vacuous pass: an empty list would satisfy "every card
      // has one" without proving anything.
      expect(numbers.length).toBeGreaterThan(0)
      expect(numbers.filter((value) => value === null)).toEqual([])
    })

    it('shows a real registration number, not just a placeholder, for the seeded applications', async () => {
      // Every seeded re-accreditation item carries an EPR-prefixed
      // registration number. If the field renders but is universally an em
      // dash, the value is not actually plumbed through — which the
      // presence-only assertion above would not catch.
      const numbers = await workItems.cardRegistrationNumbers()
      expect(numbers.some((value) => /EPR-\d+/.test(value ?? ''))).toBe(true)
    })
  })
})
