import { $, browser } from '@wdio/globals'
import { Page } from './page.js'

/**
 * The Recycling operations tab — `/work-items/{id}/recycling-operations`, a
 * real bookmarkable page reached from the case tabs, listing one row per
 * overseas reprocessing site with a Change link into its per-site edit form.
 *
 * RA-483 is the reason this page object exists. The tab renders the SAME
 * `overseasSites.sites` array as the application summary's ORS and BES rows,
 * so a removed ("deselected") site that is filtered out of the summary but
 * still listed here leaves the reported bug fully intact — a regulator can
 * still see, and still open, a site the operator withdrew.
 */
class RecyclingOperationsPage extends Page {
  /**
   * The work item id from whatever `/work-items/{id}/...` URL is currently
   * open, so a spec can move between a case's tabs without having to carry
   * the id around itself. Mirrors `gotoDetail()` on the detail page object.
   */
  async currentWorkItemId() {
    const url = await browser.getUrl()
    const match = url.match(/\/work-items\/([^/?#]+)/)
    if (!match) {
      throw new Error(`Not on a work item URL, cannot read an id from: ${url}`)
    }
    return match[1]
  }

  path(workItemId) {
    return `/work-items/${workItemId}/recycling-operations`
  }

  sitePath(workItemId, siteId) {
    // No `/edit` suffix — the per-site form hangs directly off the site id.
    return `${this.path(workItemId)}/${siteId}`
  }

  /**
   * Open the tab for the case currently on screen and wait for the site list.
   *
   * Waits on the list rather than the page heading so a caller never reads a
   * half-rendered tab. Returns the work item id because the 404 assertion
   * needs it to build a per-site URL.
   */
  async gotoForCurrentWorkItem() {
    const workItemId = await this.currentWorkItemId()
    await this.open(this.path(workItemId))
    await this.siteList().waitForDisplayed({
      timeoutMsg:
        'the recycling operations site list never rendered — the tab is ' +
        'showing no overseas sites at all'
    })
    return workItemId
  }

  /** The `<ul>` wrapping every site row. Absent when no site survives. */
  siteList() {
    return $('[data-testid="recycling-operations-site-list"]')
  }

  /**
   * One row, addressed by the RAW `siteId` from the payload rather than by
   * position. The tab sorts sites ALPHABETICALLY by name, not in payload
   * order, so an index-based lookup would silently drift as soon as the
   * fixture gains a site whose name sorts earlier.
   *
   * The ids callers pass come from management-be's `ReAccreditationSeeder`,
   * which owns them — this suite does not. If a row is unexpectedly not
   * found, check that seed's `payload.overseasSites.sites[].siteId` values
   * before suspecting the frontend.
   */
  siteRow(siteId) {
    return $(`[data-testid="recycling-operations-site-${siteId}"]`)
  }

  async hasSiteRow(siteId) {
    return this.siteRow(siteId).isExisting()
  }

  /**
   * A row's Change link. Rendered through `appActionLink`, so for a
   * read-only support session this is an inert `<span>` carrying the SAME
   * testid rather than an `<a>` — which is why callers assert on the ELEMENT
   * existing (or not), never on the presence of an href.
   */
  siteChangeLink(siteId) {
    return $(`[data-testid="recycling-operations-site-change-${siteId}"]`)
  }

  async hasSiteChangeLink(siteId) {
    return this.siteChangeLink(siteId).isExisting()
  }

  /**
   * The "no overseas reprocessing sites" empty state. Deliberately distinct
   * from `recycling-operations-no-search-results`, which means "your search
   * matched nothing" — conflating the two would let a spec accept an empty
   * tab as a passing search.
   */
  noSitesMessage() {
    return $('[data-testid="recycling-operations-no-sites"]')
  }

  async hasNoSitesMessage() {
    return this.noSitesMessage().isExisting()
  }

  /**
   * How many site rows the tab is showing. Counts the per-row `<h2>` name
   * elements inside the list; they are not unique per row by design, which is
   * exactly what makes them countable.
   */
  async siteCount() {
    const names = await this.siteList().$$(
      '[data-testid="recycling-operations-site-name"]'
    )
    return [...names].length
  }

  /** All visible text on the tab, for RA-483's page-wide absence assertion. */
  async pageText() {
    return $('body').getText()
  }

  /**
   * GET a per-site edit URL from inside the browser session and report the
   * status, so the session cookie carries over and the URL resolves against
   * whatever host this environment uses.
   *
   * The status is the whole point: hiding a removed site's Change link is not
   * a control, because the URL is guessable from any other site's link. The
   * route itself has to refuse. Same reasoning as
   * `openApprovePathDirectly()` on the detail page object.
   */
  async fetchSiteStatus(workItemId, siteId) {
    return browser.execute(
      async (url) => {
        const response = await fetch(url)
        return response.status
      },
      this.sitePath(workItemId, siteId)
    )
  }
}

export default new RecyclingOperationsPage()
