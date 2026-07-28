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

  describe('across several seeded applications', () => {
    before(async () => {
      // Bounded to the seeded re-accreditation items by searching a fragment
      // common to their organisation IDs, rather than reading the unfiltered
      // first page.
      //
      // The unfiltered list was the original approach and it was wrong: which
      // cards land on page one depends on how many items earlier specs created,
      // so "is there an EPR- number anywhere on this page" passed or failed
      // depending on spec execution order. A test whose result depends on what
      // ran before it is not evidence of anything.
      await workItems.resetFilters()
      await workItems.searchByOrgId('org-')
    })

    it('renders a registration number on every card', async () => {
      const numbers = await workItems.cardRegistrationNumbers()
      // Guard against a vacuous pass: an empty list would satisfy "every card
      // has one" without proving anything.
      expect(numbers.length).toBeGreaterThan(1)
      expect(numbers.filter((value) => value === null)).toEqual([])
    })

    it('shows real registration numbers rather than placeholders', async () => {
      // Every seeded re-accreditation item carries an EPR-prefixed
      // registration number. If the field renders but is universally an em
      // dash the value is not actually plumbed through — which the
      // presence-only assertion above would not catch. Requiring EVERY card in
      // this bounded, all-seeded set to have one is stronger than "some card
      // does", and no longer depends on which cards happen to be on page one.
      const numbers = await workItems.cardRegistrationNumbers()
      const withoutRealNumber = numbers.filter(
        (value) => !/EPR-\d+/.test(value ?? '')
      )
      expect(withoutRealNumber).toEqual([])
    })
  })
})
