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
    // Each seeded organisation is searched by name and its OWN registration
    // number asserted, rather than scanning a page of cards.
    //
    // Two earlier attempts here were unsound. Reading the unfiltered first
    // page made the outcome depend on how many items previous specs had
    // created — a test whose result depends on execution order is not
    // evidence of anything. Searching a shared "org-" fragment then matched
    // only ONE card, because only the full-payload fixture carries an
    // operatorOrganisationId at all.
    //
    // Asserting a DIFFERENT expected number per organisation is what gives
    // this teeth: a card rendering one hardcoded value, or reading the wrong
    // payload field, still satisfies a "looks like EPR-nnn" check but fails
    // here.
    const seeded = [
      ['Full Payload Verification Ltd', 'EPR-100999'],
      ['Belfast Fibres Co', 'EPR-100198']
    ]

    for (const [organisation, registrationNumber] of seeded) {
      it(`shows ${registrationNumber} on the ${organisation} card`, async () => {
        await workItems.resetFilters()
        await workItems.searchByOrgName(organisation)
        expect(await workItems.getRowCount()).toBe(1)
        const id = await workItems.firstResultWorkItemId()
        expect(await workItems.tileHasRegistrationNumber(id)).toBe(true)
        await expect(workItems.tileRegistrationNumber(id)).toHaveText(
          expect.stringContaining(registrationNumber)
        )
      })
    }
  })
})
