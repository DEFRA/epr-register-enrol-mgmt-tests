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
    if (opts.siteAddressLine2 !== undefined) {
      await $('#field-siteAddress-line2').setValue(opts.siteAddressLine2)
    }
    await $('#field-siteAddress-town').setValue(opts.siteAddressTown)
    await $('#field-siteAddress-postcode').setValue(opts.siteAddressPostcode)
    await $('#field-material').selectByAttribute('value', opts.material)
    await $('#field-tonnageBand').selectByAttribute('value', opts.tonnageBand)
    await $('[data-testid="create-work-item-submit"]').click()
    const banner = await $('[data-testid="work-item-success-banner"]')
    await expect(banner).toBeDisplayed()
    // The banner renders "Reference: RA-<9 digits>" — pull the
    // server-generated reference out of it for later assertions. Fail
    // loudly if it is absent so callers get a clear diagnostic rather
    // than a confusing "null did not match" assertion downstream. The
    // \b anchor stops a malformed longer run of digits being silently
    // truncated to a valid-looking 9-digit reference.
    const bannerText = await banner.getText()
    const match = bannerText.match(/RA-\d{9}\b/)
    if (!match) {
      throw new Error(
        `success banner had no RA-<9 digit> reference: "${bannerText}"`
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

  async clearSearch() {
    await $('[data-testid="work-items-filter-clear"]').click()
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
}

export default new WorkItemsPage()
