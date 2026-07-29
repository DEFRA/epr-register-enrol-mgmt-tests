import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-223: Show the operator's EPR Registration ID on the management UI work item.
 *
 * Regulators need the operator's EPR registration id — forwarded from the
 * upstream registration submission and stored on the work item payload as
 * `operatorRegistrationId` (e.g. `reg-008`) — visible on the detail page so
 * they can carry out further checks against the registration system. The
 * detail page renders it in a "Registration ID" row of the envelope summary
 * list, immediately after "Application ref".
 *
 * The row is deliberately sourced from `operatorRegistrationId` (the operator
 * backend's internal registration record id, e.g. `reg-008`), NOT
 * `registrationNumber` (the EPR registration number, e.g. `EPR-100198`). This
 * spec proves both the populated value (against a seeded item that carries the
 * id) and the graceful em-dash fallback (against a UI-created item that has no
 * registration id).
 *
 * RA-295 correction: this comment previously described `registrationNumber` as
 * "the Companies House company number". That was wrong — every seeded value is
 * EPR-prefixed and nothing in the payload carries a Companies House number at
 * all (Companies House data is deferred to RA-289). Confirmed with
 * management-be. The distinction still matters, and now matters more: RA-295
 * puts `registrationNumber` in the case header and on the list cards
 * (ra-295-case-header / ra-295-list-registration-number), while the
 * `operatorRegistrationId` row this spec covers survives unchanged. Two
 * similarly-named fields on the same page is exactly how they get crossed.
 *
 * NOTE (RA-299): this covers the DETAIL page's "Registration ID" row, which is
 * still shipped. It is NOT the list page's registration-ID *search filter*,
 * which RA-299 deliberately removed (org name/ID search only). They are
 * separate features that happen to share a name — this spec was deleted
 * alongside that filter removal once already, dropping real detail-page
 * coverage, and was restored after review caught it.
 */
describe('RA-223 — Registration ID shown on the work item detail page', () => {
  before(async () => {
    // No nation → a multi-nation "see all" user, so the seeded item below is
    // visible regardless of which nation it was seeded into.
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('a seeded work item that carries an operator registration id', () => {
    // The seeded "Belfast Fibres Co" re-accreditation item carries
    // operatorRegistrationId "reg-008" (ReAccreditationSeeder) and stays in the
    // non-archived "submitted" state, so it is reachable from the default list
    // via an org-name search. The org name is unique to the seed data (no spec
    // creates it), so the search returns exactly this item.
    before(async () => {
      // RA-299: a bare landing now defaults to "assigned to me", which would
      // hide this unassigned seeded item — reset to an explicit empty filter
      // so the org-name search is not implicitly assignee-scoped.
      await workItems.resetFilters()
      await workItems.searchByOrgName('Belfast Fibres Co')
      // Wait for the filtered list to settle before reading it — applying any
      // filter is a GET that redirects with filtersApplied=1, so the pre-filter
      // rows must not be acted on.
      await browser.waitUntil(
        async () => (await browser.getUrl()).includes('filtersApplied=1'),
        { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
      )
      // Hard gate before opening a row: the search must resolve to exactly the
      // one seeded item. 0 rows means the seeded "Belfast Fibres Co" item is
      // absent or archived; >1 means the org name is no longer unique. Failing
      // here stops us opening the wrong row with an opaque timeout downstream.
      expect(await workItems.getRowCount()).toBe(1)
      await workItems.openFirstListedWorkItem()
    })

    it('renders an "Operator registration ID" row', async () => {
      // RA-295 moved this from the removed envelope summary list into the
      // reference block at the foot of the page, and RELABELLED it from
      // "Registration ID" to "Operator registration ID" — deliberately, to
      // stop it being confused with the "Registration number" that RA-295 puts
      // in the case header and on the list cards.
      expect(await detail.hasSummaryKey('Operator registration ID')).toBe(true)
    })

    it('shows the operator registration id from the payload', async () => {
      const value = await detail.getSummaryValueByKey(
        'Operator registration ID'
      )
      expect(value).toBe('reg-008')
    })

    it('keeps it distinct from the registration number', async () => {
      // Both fields are now on the same page, which is exactly how they get
      // crossed. Belfast Fibres Co carries operatorRegistrationId "reg-008"
      // AND registrationNumber "EPR-100198", so a mix-up is detectable here.
      expect(await detail.getSummaryValueByKey('Registration number')).toBe(
        'EPR-100198'
      )
    })
  })

  describe('a work item created through the UI (no registration id)', () => {
    // Items created through the management UI form carry no
    // operatorRegistrationId (it originates from the upstream registration
    // submission), so the row must degrade gracefully to an em-dash rather
    // than leaking any other identifier.
    before(async () => {
      await workItems.resetFilters()
      const { id } = await workItems.createWorkItem({
        organisationName: 'Registration Id Recyclers Ltd',
        siteAddressLine1: '1 Registry Road',
        siteAddressTown: 'Sheffield',
        siteAddressPostcode: 'S1 1AA',
        material: 'paper',
        tonnageBand: '0-500'
      })
      await workItems.openWorkItem(id)
    })

    it('omits the row entirely when the work item has no registration id', async () => {
      // Behaviour change in RA-295, not a relaxation of the test. The old
      // envelope summary rendered an em-dash placeholder; the reference block
      // omits valueless rows outright. So the correct assertion is row-ABSENT.
      //
      // Asserting the em dash here would now fail, and — more insidiously —
      // asserting "the value is not reg-xxx" would pass vacuously against a
      // missing row. Absence is the only assertion that means anything.
      expect(await detail.hasSummaryKey('Operator registration ID')).toBe(false)
    })

    it('still renders the rows it does have values for', async () => {
      // Guards the assertion above against passing because the whole reference
      // block failed to render. A UI-created item always has a work item ID.
      expect(await detail.hasSummaryKey('Work item ID')).toBe(true)
    })
  })
})
