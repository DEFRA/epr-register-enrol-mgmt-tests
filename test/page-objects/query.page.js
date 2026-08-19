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

/**
 * RA-367. Broadly equivalent standards (BES) and Overseas reprocessing sites
 * (ORS) are EXPORTER-ONLY query areas. They must render on the query form for
 * an exporter application and be absent for a reprocessor one.
 *
 * The frontend gates them on `isExporterApplication(workItem)` — the SAME
 * proxy RA-295 uses for the exporter-only detail rows: it returns true iff
 * `payload.overseasSites.sites` is non-empty. There is no `wasteProcessingType`
 * discriminator in the work item payload (management-be never writes one), so
 * "exporter" means "has overseas sites" and "reprocessor" means "has none".
 * (Confirmed by management-fe: the guard reuses application-summary.js's
 * isExporterApplication rather than reading any type field.)
 */
export const EXPORTER_ONLY_QUERY_SECTIONS = [
  'broadly-equivalent-standards',
  'overseas-reprocessing-sites'
]

/** The four query areas every application shows, exporter or reprocessor. */
export const REPROCESSOR_QUERY_SECTIONS = QUERY_SECTIONS.filter(
  (section) => !EXPORTER_ONLY_QUERY_SECTIONS.includes(section)
)

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

  /**
   * RA-367. Whether the checkbox for a section value is rendered on the query
   * form at all. Distinct from isSectionSelected (which asks whether an
   * existing checkbox is ticked) — this asks whether the option exists, which
   * is what the exporter-only gating turns on.
   */
  async hasSection(value) {
    return this.sectionCheckbox(value).isExisting()
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

  /**
   * RA-434. The "The reason you provide is for internal use only." hint
   * under the Reason field. Always shown — unlike assignmentNotice() below,
   * it does not depend on assignment state.
   *
   * Its own `query-reason-hint` testid, not a `[data-testid="query-reason"]
   * .govuk-hint` descendant selector: govukCharacterCount's `attributes`
   * param lands on the `<textarea>` itself (confirmed against
   * govuk-frontend's textarea template), and the hint renders as that
   * textarea's SIBLING inside the form group — never its descendant — so a
   * descendant selector off `query-reason` can never match.
   */
  reasonHint() {
    return $('[data-testid="query-reason-hint"]')
  }

  async submit() {
    await $('[data-testid="query-submit"]').click()
  }

  async cancel() {
    await $('[data-testid="query-cancel"]').click()
  }

  /**
   * RA-295 (AC04). "The operator query status will be updated." inset text
   * (copy updated by RA-434 — was "When you send the query, the application
   * will also be assigned to you.").
   *
   * Before RA-295 this rendered unconditionally. The AC makes it conditional:
   * it must appear when the application is UNASSIGNED (querying will take
   * ownership) and must NOT appear when the application is already assigned
   * (where the underlying behaviour — assigning the application — does not
   * happen). Both directions are asserted, because the presence half alone
   * passes against the old unconditional markup and could never fail.
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
