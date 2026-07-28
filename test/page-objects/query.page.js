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

  /**
   * RA-295 (AC04). The "When you send the query, the application will also be
   * assigned to you." inset text.
   *
   * Before RA-295 this rendered unconditionally. The AC makes it conditional:
   * it must appear when the application is UNASSIGNED (querying will take
   * ownership) and must NOT appear when the application is already assigned
   * (where the sentence is simply untrue — it would tell a caseworker their
   * colleague's application is about to change hands). Both directions are
   * asserted, because the presence half alone passes against the old
   * unconditional markup and could never fail.
   */
  assignmentNotice() {
    return $('[data-testid="query-assignment-notice"]')
  }

  async hasAssignmentNotice() {
    return this.assignmentNotice().isExisting()
  }

  async assertErrorSummaryDisplayed() {
    await expect($('[data-testid="query-error-summary"]')).toBeDisplayed()
  }

  async errorSummaryText() {
    return $('[data-testid="query-error-summary"]').getText()
  }

  /**
   * The live "You have N words remaining" countdown.
   *
   * Deliberately NOT `#field-reason-info`. On init the CharacterCount
   * component repurposes that element as the visually-hidden screen-reader
   * description, leaving its server-rendered "You can enter up to 200
   * words" text untouched, and inserts a *new*
   * `div.govuk-character-count__status` to carry the visible count. Reading
   * the `-info` element therefore reports the static fallback forever and
   * silently misses a broken counter.
   */
  async characterCountMessage() {
    return $('.govuk-character-count__status').getText()
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
