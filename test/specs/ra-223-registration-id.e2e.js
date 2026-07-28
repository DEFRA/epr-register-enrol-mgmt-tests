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
 * The row is deliberately sourced from `operatorRegistrationId` (the EPR
 * registration id), NOT `registrationNumber` (the Companies House company
 * number). This spec proves both the populated value (against a seeded item
 * that carries the id) and the graceful em-dash fallback (against a UI-created
 * item that has no registration id).
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

    it('renders a "Registration ID" summary row', async () => {
      expect(await detail.hasSummaryKey('Registration ID')).toBe(true)
    })

    it('shows the operator EPR registration id from the payload', async () => {
      const value = await detail.getSummaryValueByKey('Registration ID')
      expect(value).toBe('reg-008')
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

    it('renders a "Registration ID" summary row', async () => {
      const hasRow = await detail.hasSummaryKey('Registration ID')
      expect(hasRow).toBe(true)
    })

    it('falls back to an em-dash when the work item has no registration id', async () => {
      const value = await detail.getSummaryValueByKey('Registration ID')
      expect(value).toBe('—')
    })
  })
})
