import { browser, $, expect } from '@wdio/globals'
import { Page } from './page.js'

class WorkItemsPage extends Page {
  async goto() {
    await this.open('/work-items')
    await expect($('[data-testid="app-heading-title"]')).toHaveText(
      'Work items'
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

  async filterByNation(nation) {
    await $(`input[name="nation"][value="${nation}"]`).click()
    await $('[data-testid="work-items-filter-apply"]').click()
  }

  async searchByOrgId(value) {
    await $('[data-testid="work-items-filter-org-id"]').setValue(value)
    await $('[data-testid="work-items-filter-apply"]').click()
  }

  async searchByRegistrationId(value) {
    await $('[data-testid="work-items-filter-registration-id"]').setValue(value)
    await $('[data-testid="work-items-filter-apply"]').click()
  }

  async searchByOrgName(value) {
    await $('[data-testid="work-items-filter-org-name"]').setValue(value)
    await $('[data-testid="work-items-filter-apply"]').click()
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
    await $('[data-testid="work-items-filter-apply"]').click()
  }

  async getWorkItemCount() {
    const summary = await $('[data-testid="work-items-summary"]').getText()
    const match = summary.match(/\((\d+) work item/)
    return match ? parseInt(match[1], 10) : 0
  }

  async workItemOrgNameCell(id) {
    const row = await this.workItemRow(id)
    const cells = await row.$$('td')
    return cells[3]
  }

  async getTableHeaderTexts() {
    const table = await $('[data-testid="work-items-table"]')
    const headers = await table.$$('.govuk-table__header')
    return Promise.all([...headers].map((h) => h.getText()))
  }

  workItemRow(id) {
    return $(`//*[@data-testid="work-item-link-${id}"]/ancestor::tr`)
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
    return $('[data-testid="work-items-filter-apply"]').click()
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

  /** Number of work-item rows currently rendered in the list table. */
  async getRowCount() {
    const rows = await $$('[data-testid="work-items-table"] tbody tr')
    return rows.length
  }
}

export default new WorkItemsPage()
