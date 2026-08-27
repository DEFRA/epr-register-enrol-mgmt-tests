import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import recyclingOperations from '../page-objects/recycling-operations.page.js'

/**
 * RA-483 — a removed ("deselected") Overseas Reprocessing Site must not be
 * visible in case management.
 *
 * The reported bug: an operator REMOVED a German ORS before submitting, and
 * the regulator was still shown it on the case-working screen with nothing to
 * say it had been removed. With dozens of ORSs on a real application that is a
 * live risk of accrediting a site the operator withdrew.
 *
 * The operator journey removes a site by DESELECTING it (`selected: false`),
 * never by deleting it, so the removed site is still present in the stored
 * application and still travels as far as the case-working payload boundary.
 * "It is gone from the data" is therefore not something case management can
 * assume — the filtering is a real behaviour that needs a real test.
 *
 * Runs against the `full-payload-verification` ReAccreditation seed item,
 * whose `payload.overseasSites.sites` carries a deliberate PAIR
 * (ReAccreditationSeeder):
 *
 *   siteId 1  Full Payload Verification Overseas Site  Netherlands  selected: true
 *   siteId 2  Removed Overseas Site                    Germany      selected: false
 *
 * The pair is the point. A regression that filters too HARD — dropping the ORS
 * section wholesale, or failing the exporter discriminator so the section
 * never renders — would satisfy a test that only asserted the removed site is
 * absent, and would look like a pass while the regulator saw no overseas sites
 * at all. So every negative below is anchored by a positive: site 1 must be
 * there, exactly once, at the same time as site 2 is nowhere.
 */
describe('RA-483 — removed overseas sites are hidden in case management', () => {
  // The still-selected site, which MUST render.
  const selectedSiteName = 'Full Payload Verification Overseas Site'
  const selectedSiteCountry = 'Netherlands'

  // Every distinctive string belonging to the removed site. Asserting on the
  // name alone would miss a template that dropped the name line but still
  // rendered the site's address or country block — the regulator would still
  // be looking at a removed site, just an anonymous one.
  const removedSiteText = [
    'Removed Overseas Site',
    'Germany',
    'Withdrawn Weg',
    'Hamburg'
  ]

  before(async () => {
    await login.login()
    // A bare landing defaults to assigned-to-me (RA-299), which hides this
    // unassigned seeded item — reset to an explicit empty filter so the search
    // is not implicitly assignee-scoped.
    await workItems.resetFilters()
    await workItems.searchByOrgName('Full Payload Verification Ltd')
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('filtersApplied=1'),
      { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
    )
    // Hard gate: the search must resolve to exactly the one seeded item, so
    // "the first row" is unambiguous.
    expect(await workItems.getRowCount()).toBe(1)
    await workItems.openFirstListedWorkItem()
    // The ORS row only exists on an Exporter application. Waiting for it here
    // means a missing-row failure is reported once, as a clear timeout, rather
    // than as a confusing "element not found" inside whichever assertion below
    // happened to run first.
    await detail.applicationDetailRow('ors').waitForDisplayed({
      timeoutMsg:
        'the ORS row never rendered — the seeded exporter application is not ' +
        'showing its overseas sites at all'
    })
  })

  after(async () => {
    await login.logout()
  })

  describe('the ORS row', () => {
    it('renders exactly one overseas site block', async () => {
      // The count assertion the AC needs to fail LOUDLY on: an unfiltered
      // render puts two blocks here, and a count is the only assertion that
      // catches a duplicate-render regression where the removed site is
      // filtered out but the selected one is drawn twice.
      expect(await detail.overseasSiteCount()).toBe(1)
    })

    it('renders the selected overseas site', async () => {
      const names = await detail.overseasSiteNames()
      expect(names).toHaveLength(1)
      // `toContain` rather than an equality check: the name line folds in the
      // "NEW:" prefix when the site is new against the previous accreditation
      // year, and this spec is not about that flag.
      expect(names[0]).toContain(selectedSiteName)
    })

    it('does not render the removed overseas site', async () => {
      const ors = await detail.applicationDetailRowText('ors')
      // Asserted before the page-wide check below so a failure names the row
      // that is actually at fault.
      expect(ors).toContain(selectedSiteName)
      for (const text of removedSiteText) {
        expect(ors).not.toContain(text)
      }
    })
  })

  describe('the BES evidence row', () => {
    // The BES row maps over the SAME `overseasSites.sites` array as the ORS
    // row. Filtering one and not the other is the most likely partial fix, and
    // it would leave the removed site's name on screen under a different
    // heading — which is the bug, unchanged.
    it('lists only the selected site', async () => {
      const sites = await detail.besSiteTexts()
      expect(sites).toHaveLength(1)
      expect(sites[0]).toContain(selectedSiteName)
      expect(sites[0]).toContain(selectedSiteCountry)
    })

    it('does not list the removed site', async () => {
      const bes = await detail.applicationDetailRowText('bes')
      for (const text of removedSiteText) {
        expect(bes).not.toContain(text)
      }
    })
  })

  describe('the page as a whole', () => {
    it('shows the removed overseas site nowhere on the screen', async () => {
      // AC01 verbatim: not displayed/visible, anywhere. Row-scoped assertions
      // alone would pass if some other section — now or later — read the same
      // unfiltered array, so this is the assertion that actually matches the
      // wording of the criterion.
      const page = await detail.pageText()
      // The anchor again: proving a string is absent from a page that failed
      // to render is worthless, so confirm the selected site IS on screen in
      // the very same read.
      expect(page).toContain(selectedSiteName)
      for (const text of removedSiteText) {
        expect(page).not.toContain(text)
      }
    })
  })

  describe('the Recycling operations tab', () => {
    /**
     * The second case-management screen that renders the same
     * `overseasSites.sites` array. Filtering the application summary alone
     * would leave the reported bug fully intact here — the regulator would
     * still see the withdrawn German site, and could still open its edit
     * form and record recycling operations against it.
     *
     * Rows are addressed by their raw payload `siteId` throughout, because
     * this tab sorts sites ALPHABETICALLY by name rather than in payload
     * order; a positional lookup would drift the moment the fixture gains a
     * site whose name sorts earlier.
     */
    let workItemId

    before(async () => {
      workItemId = await recyclingOperations.gotoForCurrentWorkItem()
    })

    it('lists only the selected site', async () => {
      expect(await recyclingOperations.siteCount()).toBe(1)
      expect(await recyclingOperations.hasSiteRow(1)).toBe(true)
      // The over-firing anchor for this tab: a filter that dropped every site
      // renders the "no overseas reprocessing sites" empty state, which would
      // otherwise satisfy every absence assertion below while showing the
      // regulator nothing at all.
      expect(await recyclingOperations.hasNoSitesMessage()).toBe(false)
    })

    it('neither lists the removed site nor offers a way into it', async () => {
      expect(await recyclingOperations.hasSiteRow(2)).toBe(false)
      expect(await recyclingOperations.hasSiteChangeLink(2)).toBe(false)
      // Asserted alongside, so "no Change link for site 2" cannot pass simply
      // because the tab stopped rendering Change links altogether.
      expect(await recyclingOperations.hasSiteChangeLink(1)).toBe(true)
    })

    it('shows the removed site nowhere on the tab', async () => {
      const page = await recyclingOperations.pageText()
      expect(page).toContain(selectedSiteName)
      for (const text of removedSiteText) {
        expect(page).not.toContain(text)
      }
    })

    it("refuses a direct request for the removed site's edit page", async () => {
      // Hiding the Change link is not a control: the per-site URL is trivially
      // guessable from any other row's link, and a removed siteId is just a
      // number. The route itself has to refuse, so this asserts the status
      // rather than what the tab chose to render.
      expect(await recyclingOperations.fetchSiteStatus(workItemId, 1)).toBe(200)
      expect(await recyclingOperations.fetchSiteStatus(workItemId, 2)).toBe(404)
    })
  })
})
