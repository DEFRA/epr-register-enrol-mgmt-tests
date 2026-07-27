import { browser, $, expect } from '@wdio/globals'
import { Page } from './page.js'

/**
 * RA-324 (AC05). The order in which a tile renders its fields. The
 * application-reference link is the first field (its id-keyed testid is
 * normalised to 'application-ref' by tileFieldOrder); the rest are the
 * generic field testids. Exported so the spec asserts against the same source
 * of truth the page object reads, rather than a second hand-kept copy.
 */
export const TILE_FIELD_ORDER = [
  'application-ref',
  'org-name',
  'org-id',
  'material',
  'applicant-type',
  'submitted-on',
  'assigned-to',
  'due-date'
]

class WorkItemsPage extends Page {
  async goto() {
    await this.open('/work-items')
    // RA-324: the work-items list was redesigned into the "Applications"
    // tiles page. The route is unchanged (/work-items) but the H1 now reads
    // "Applications"; the nav LINK that reaches this page stays labelled
    // "Work items".
    await expect($('[data-testid="app-heading-title"]')).toHaveText(
      'Applications'
    )
  }

  async clickCreateWorkItem() {
    await $('[data-testid="work-items-create-link"]').click()
    await browser.waitUntil(async () =>
      (await browser.getUrl()).includes('/work-items/re-accreditation/new')
    )
  }

  async createWorkItem(opts) {
    await this.clickCreateWorkItem()
    // The application reference is no longer entered on the form — the
    // case management backend generates it on submission. Callers read
    // it back from the success banner after the work item is created.
    // Email field is pre-filled with test@defra.gov.uk. Callers
    // may override via opts.operatorEmail; otherwise we leave the default value
    // in place.
    if (opts.operatorEmail !== undefined) {
      await $('#field-operatorEmail').setValue(opts.operatorEmail)
    }
    await $('#field-organisationName').setValue(opts.organisationName)
    await $('#field-siteAddress-line1').setValue(opts.siteAddressLine1)
    // The create form pre-fills line 2 with example text, so an empty
    // string means "clear the field" rather than "leave the default".
    if (opts.siteAddressLine2 !== undefined) {
      const line2 = await $('#field-siteAddress-line2')
      await line2.clearValue()
      if (opts.siteAddressLine2 !== '') {
        await line2.setValue(opts.siteAddressLine2)
      }
    }
    await $('#field-siteAddress-town').setValue(opts.siteAddressTown)
    await $('#field-siteAddress-postcode').setValue(opts.siteAddressPostcode)
    await $('#field-material').selectByAttribute('value', opts.material)
    await $('#field-tonnageBand').selectByAttribute('value', opts.tonnageBand)
    await $('[data-testid="create-work-item-submit"]').click()
    const banner = await $('[data-testid="work-item-success-banner"]')
    await expect(banner).toBeDisplayed()
    // The banner renders "Reference: AP..." (RA-318: AP + year + agency +
    // orgId + postcode suffix + material prefix, max 18 chars) — pull the
    // server-generated reference out of it for later assertions. Fail
    // loudly if it is absent so callers get a clear diagnostic rather
    // than a confusing "null did not match" assertion downstream.
    const bannerText = await banner.getText()
    const match = bannerText.match(/AP[A-Z0-9]+\b/)
    if (!match) {
      throw new Error(
        `success banner had no AP-prefixed reference: "${bannerText}"`
      )
    }
    const applicationReference = match[0]
    const url = await browser.getUrl()
    const id = url.split('/').pop()
    return { id, applicationReference }
  }

  async openWorkItem(id) {
    await this.open(`/work-items/${id}`)
  }

  /**
   * Open the first work item currently listed by clicking its row link.
   * Used to reach a backend-seeded item whose id is not known to the test —
   * pair it with a bounding search (e.g. searchByOrgName) so exactly one row
   * is present and the "first" row is unambiguous.
   */
  async openFirstListedWorkItem() {
    const link = await $('[data-testid^="work-item-link-"]')
    await link.waitForClickable()
    await link.click()
    // Wait for the detail page to render so callers can read the summary list
    // without racing a slow navigation.
    await $('[data-testid="work-item-summary"]').waitForDisplayed()
  }

  workItemLink(id) {
    return $(`[data-testid="work-item-link-${id}"]`)
  }

  workItemStateTag(id) {
    return $(`[data-testid="work-item-state-tag-${id}"]`)
  }

  /**
   * Click Apply and wait for the filtered page to actually load.
   *
   * Applying a filter is a full page navigation. Without this wait the
   * caller races it and can read rows from the *unfiltered* list still on
   * screen — which silently returns the wrong work item rather than
   * failing, and gets worse the more items the suite has created. The
   * server stamps filtersApplied=1 on the query string, so that is the
   * signal the new page has arrived.
   */
  async applyFiltersAndWait() {
    await $('[data-testid="work-items-filter-apply"]').click()
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('filtersApplied=1'),
      {
        timeout: 10000,
        timeoutMsg: 'Expected the filters to be applied to the work items list'
      }
    )
  }

  async filterByNation(nation) {
    await $(`input[name="nation"][value="${nation}"]`).click()
    await this.applyFiltersAndWait()
  }

  async searchByOrgId(value) {
    await $('[data-testid="work-items-filter-org-id"]').setValue(value)
    await this.applyFiltersAndWait()
  }

  async searchByRegistrationId(value) {
    await $('[data-testid="work-items-filter-registration-id"]').setValue(value)
    await this.applyFiltersAndWait()
  }

  async searchByOrgName(value) {
    await $('[data-testid="work-items-filter-org-name"]').setValue(value)
    await this.applyFiltersAndWait()
  }

  /**
   * Reads the work item id out of the first result row's link testid.
   * Used for seeded items whose id is not known up front (unlike items
   * created via createWorkItem, which return their id directly).
   */
  async firstResultWorkItemId() {
    const link = await $('[data-testid^="work-item-link-"]')
    const testId = await link.getAttribute('data-testid')
    return testId.replace('work-item-link-', '')
  }

  async clearSearch() {
    await $('[data-testid="work-items-filter-clear"]').click()
  }

  /**
   * RA-224. Reveal archived (terminal-state) work items by enabling the
   * "Show archived" filter alongside an org-name search, then apply. The
   * org-name search keeps the result set bounded so presence assertions
   * stay pagination-safe even when the archived view holds unrelated
   * items created by other specs.
   */
  async searchArchivedByOrgName(value) {
    const includeArchived = await $(
      '[data-testid="work-items-filter-include-archived"]'
    )
    if (!(await includeArchived.isSelected())) {
      await includeArchived.click()
    }
    await $('[data-testid="work-items-filter-org-name"]').setValue(value)
    await this.applyFiltersAndWait()
  }

  async getWorkItemCount() {
    const summary = await $('[data-testid="work-items-summary"]').getText()
    const match = summary.match(/\((\d+) work item/)
    return match ? parseInt(match[1], 10) : 0
  }

  async getFilterLegendTexts() {
    const form = await $('[data-testid="work-items-filter-form"]')
    const legends = await form.$$('legend')
    return Promise.all([...legends].map((l) => l.getText()))
  }

  async getRegulatorOptionTexts() {
    const labels = await $$('//input[@name="nation"]/../label')
    return Promise.all([...labels].map((l) => l.getText()))
  }

  // ── Checkbox/radio filters + pagination ──────────────────────────────────── //

  filterForm() {
    return $('[data-testid="work-items-filter-form"]')
  }

  applyFilters() {
    return this.applyFiltersAndWait()
  }

  async checkType(value) {
    await $(`input[name="typeId"][value="${value}"]`).click()
  }

  async checkState(value) {
    await $(`input[name="stateId"][value="${value}"]`).click()
  }

  async checkRegulator(nation) {
    await $(`input[name="nation"][value="${nation}"]`).click()
  }

  async setAssignmentMode(mode) {
    await $(`input[name="assigneeMode"][value="${mode}"]`).click()
  }

  async selectSpecificUser(userId) {
    await $('input[name="assigneeMode"][value="user"]').click()
    await $(
      '[data-testid="work-items-filter-assignee-user"]'
    ).selectByAttribute('value', userId)
  }

  /** Read the value of the first <option> in the specific-user select. */
  async firstAssignableUserId() {
    const options = await $$(
      '[data-testid="work-items-filter-assignee-user"] option'
    )
    for (const option of options) {
      const value = await option.getAttribute('value')
      if (value) {
        return value
      }
    }
    return null
  }

  clearFilters() {
    return $('[data-testid="work-items-filter-clear"]').click()
  }

  clearFiltersLink() {
    return $('[data-testid="work-items-filter-clear"]')
  }

  getSummaryText() {
    return $('[data-testid="work-items-summary"]').getText()
  }

  /**
   * The results summary line. It is rendered only when the backend query
   * succeeds (ok=true) — on a failed query the template swaps it for the
   * "Could not reach the backend" notification banner instead. Its presence
   * is therefore a positive signal that GET /work-items returned rather than
   * 500'd (RA-342).
   */
  worklistSummary() {
    return $('[data-testid="work-items-summary"]')
  }

  /**
   * The GOV.UK notification banner the worklist renders when the backend
   * query fails (titleText "Could not reach the backend", body e.g.
   * "Backend returned 500"). No data-testid exists on it, so the GOV.UK
   * component class is the selector. Used by RA-342 to assert the legacy
   * snapshot no longer crashes the whole worklist batch.
   */
  worklistErrorBanner() {
    return $('.govuk-notification-banner')
  }

  pagination() {
    return $('.govuk-pagination')
  }

  async hasPagination() {
    return (await this.pagination().isExisting())
      ? await this.pagination().isDisplayed()
      : false
  }

  /** All page-link hrefs inside the GOV.UK pagination component. */
  async paginationHrefs() {
    const links = await $$('.govuk-pagination__link')
    return Promise.all([...links].map((l) => l.getAttribute('href')))
  }

  nextPageLink() {
    return $('.govuk-pagination__next .govuk-pagination__link')
  }

  async gotoNextPage() {
    await this.nextPageLink().click()
  }

  /**
   * Number of work items currently rendered in the results region. RA-324
   * replaced the govukTable with one <article data-testid="application-tile">
   * per application, so the count is the number of tiles rather than table
   * rows. Search/filter/pagination are unchanged, so callers that bound the
   * list first still get a deterministic count.
   */
  async getRowCount() {
    return this.getTileCount()
  }

  // ── RA-324 Applications tiles ────────────────────────────────────────────── //

  /** All application tiles currently rendered (document order). */
  tiles() {
    return $$('[data-testid="application-tile"]')
  }

  async getTileCount() {
    const tiles = await this.tiles()
    return tiles.length
  }

  /**
   * The tile <article> for a given work item id. Each tile carries
   * data-work-item-id="{id}" so a specific application can be located
   * directly, without depending on its position in the list.
   */
  tileFor(id) {
    return $(`[data-testid="application-tile"][data-work-item-id="${id}"]`)
  }

  /**
   * A field element inside a tile, located by its generic field testid
   * (org-name, org-id, material, applicant-type, submitted-on, assigned-to,
   * due-date). Scoped to the tile so it cannot resolve a field on a
   * different application. The application reference field is the tile link
   * itself (workItemLink(id)), not a generic field testid.
   */
  tileField(id, field) {
    return this.tileFor(id).$(`[data-testid="${field}"]`)
  }

  /** Whether a (conditional) field is rendered inside a tile. */
  async tileHasField(id, field) {
    return this.tileFor(id).$(`[data-testid="${field}"]`).isExisting()
  }

  /**
   * The tile's status badge (RA-324 renders it as a govukTag with the
   * existing id-keyed testid). Alias of workItemStateTag for readability in
   * the Applications specs.
   */
  tileStatusBadge(id) {
    return this.workItemStateTag(id)
  }

  /**
   * The AC05 field testids present in a tile, in document order, with the
   * application-reference link normalised to the logical name
   * 'application-ref'. Lets a spec assert the fields render in the defined
   * order without requiring every conditional field to be present.
   */
  async tileFieldOrder(id) {
    const tile = await this.tileFor(id)
    const elements = await tile.$$('[data-testid]')
    const seen = []
    for (const element of elements) {
      let testId = await element.getAttribute('data-testid')
      if (testId === `work-item-link-${id}`) testId = 'application-ref'
      if (TILE_FIELD_ORDER.includes(testId) && !seen.includes(testId)) {
        seen.push(testId)
      }
    }
    return seen
  }
}

export default new WorkItemsPage()
