import { $, $$, browser, expect } from '@wdio/globals'
import { Page } from './page.js'

/**
 * RA-291 — Query an application.
 *
 * Two endpoints:
 *   1. GET  /work-items/{id}/query — the query page: section checkboxes,
 *      a 200-word reason and a Cancel link
 *   2. POST /work-items/{id}/query — records the query against the
 *      application and PRG-redirects back to the work item
 *
 * The six section values mirror the frontend's QUERY_SECTION_OPTIONS; the
 * backend validates against the same list, so a drift on either side shows
 * up here as a validation error rather than a silent mismatch.
 */
export const QUERY_SECTIONS = [
  'authority-to-issue',
  'business-plan',
  'prn-tonnage',
  'sampling-and-inspection-plan',
  'broadly-equivalent-standards',
  'overseas-reprocessing-sites'
]

class QueryPage extends Page {
  async gotoFor(workItemId) {
    await this.open(`/work-items/${workItemId}/query`)
    await this.assertOnQueryPage()
  }

  async assertOnQueryPage() {
    await expect($('[data-testid="query-form"]')).toBeDisplayed()
    await expect($('[data-testid="query-lead"]')).toBeDisplayed()
  }

  /**
   * The checkbox for a section value. govukCheckboxes renders the value on
   * the input itself, so selecting by value keeps this independent of the
   * order the options happen to be declared in.
   */
  sectionCheckbox(value) {
    return $(`input[name="sections"][value="${value}"]`)
  }

  async selectSection(value) {
    const checkbox = await this.sectionCheckbox(value)
    if (!(await checkbox.isSelected())) {
      await checkbox.click()
    }
  }

  async selectSections(values) {
    for (const value of values) {
      await this.selectSection(value)
    }
  }

  async countSectionOptions() {
    return (await $$('input[name="sections"]')).length
  }

  async isSectionSelected(value) {
    return (await this.sectionCheckbox(value)).isSelected()
  }

  async fillReason(text) {
    if (text !== undefined) {
      await $('#field-reason').setValue(text)
    }
  }

  async submit() {
    await $('[data-testid="query-submit"]').click()
  }

  async cancel() {
    await $('[data-testid="query-cancel"]').click()
  }

  async assertErrorSummaryDisplayed() {
    await expect($('[data-testid="query-error-summary"]')).toBeDisplayed()
  }

  async errorSummaryText() {
    return $('[data-testid="query-error-summary"]').getText()
  }

  /**
   * The character-count hint govuk-frontend renders alongside the textarea.
   * Present server-side as static text; the client JS turns it into a live
   * countdown once CharacterCount is initialised.
   */
  async characterCountMessage() {
    return $('#field-reason-info').getText()
  }

  async waitForDetailUrl(workItemId) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === `/work-items/${workItemId}`
      },
      {
        timeout: 10000,
        timeoutMsg: `Expected to land on /work-items/${workItemId} after the query flow`
      }
    )
  }

  async waitForQueryUrl(workItemId) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === `/work-items/${workItemId}/query`
      },
      {
        timeout: 10000,
        timeoutMsg: `Expected to stay on /work-items/${workItemId}/query`
      }
    )
  }
}

export default new QueryPage()
