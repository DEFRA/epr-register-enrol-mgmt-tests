import { $, $$, browser, expect } from '@wdio/globals'
import { Page } from './page.js'

/**
 * RA-316 — duly making.
 *
 * Replaces the task-driven route into `duly-made`. The `submitted`-state
 * tasks (`verify-organisation-details`, `confirm-application-completeness`)
 * and the hook that auto-transitioned off their completion are deleted, so
 * the ONLY way a caseworker reaches `duly-made` is:
 *
 *   1. "Duly make" CTA on the detail page (submitted state only)
 *   2. GET  /work-items/re-accreditation/{id}/duly-make
 *   3. POST /work-items/re-accreditation/{id}/duly-make
 *
 * Same path for GET and POST. NOTE THE `re-accreditation` SEGMENT: duly
 * making is a module-specific route, not a generic framework one, so it
 * namespaces under `/work-items/<type-id>/` alongside `approve` and
 * `continue-review`. It is deliberately NOT shaped like `/query` or
 * `/sla/extend`, which are generic routes shared by every work item type.
 *
 * Cancel is a PLAIN LINK back to the detail page — it never reaches the
 * backend, so there is no state change by construction.
 *
 * SELECTOR PREFIXES ARE LOAD-BEARING. Everything here is under
 * `duly-make-*` / `duly-making-*` and nothing under `work-item-task*`,
 * because `work-item-detail.page.js` selects tasks with the PREFIX match
 * `li[data-testid^="work-item-task-"]`. A hook named `work-item-task-...`
 * would silently fold into that task-list match and corrupt `taskIds()`.
 * See the RA-372 comment in management-fe's `detail.njk`.
 */
class DulyMakingPage extends Page {
  path(workItemId) {
    return `/work-items/re-accreditation/${workItemId}/duly-make`
  }

  /**
   * Navigate straight to the page, bypassing the CTA.
   *
   * Hiding a CTA is not a control — used by the guard specs to prove the
   * route itself refuses from the wrong state.
   */
  async gotoFor(workItemId) {
    await this.open(this.path(workItemId))
  }

  async assertOnPage() {
    await expect(this.pageHeading).toHaveText('Duly make the application')
    await expect($('[data-testid="duly-making-submit"]')).toBeDisplayed()
  }

  chargeAmount() {
    return $('[data-testid="duly-making-charge-amount"]')
  }

  paymentReference() {
    return $('[data-testid="duly-making-payment-reference"]')
  }

  async chargeAmountText() {
    return this.chargeAmount().getText()
  }

  async paymentReferenceText() {
    return this.paymentReference().getText()
  }

  /**
   * The GOV.UK date input parts.
   *
   * Selected by id rather than data-testid on management-fe's instruction:
   * the ids are what the error-summary links target, so asserting against
   * them keeps the "click the error, land on the field" contract honest.
   */
  dayInput() {
    return $('#payment-date-day')
  }

  monthInput() {
    return $('#payment-date-month')
  }

  yearInput() {
    return $('#payment-date-year')
  }

  /**
   * Fill the payment date. Any part may be omitted to exercise the
   * incomplete-date branch; parts are cleared first so a re-submit after a
   * validation error does not inherit the previous attempt's digits.
   */
  async setPaymentDate({ day, month, year } = {}) {
    const parts = [
      [this.dayInput(), day],
      [this.monthInput(), month],
      [this.yearInput(), year]
    ]
    for (const [field, value] of parts) {
      await field.setValue('')
      if (value !== undefined && value !== null && value !== '') {
        await field.setValue(String(value))
      }
    }
  }

  async submit() {
    await $('[data-testid="duly-making-submit"]').click()
  }

  async cancel() {
    await $('[data-testid="duly-making-cancel"]').click()
  }

  async submitButtonText() {
    return $('[data-testid="duly-making-submit"]').getText()
  }

  async cancelLinkText() {
    return $('[data-testid="duly-making-cancel"]').getText()
  }

  /**
   * AC02 — the page carries payment details only.
   *
   * The task-driven route had note/comment affordances hanging off it; the
   * replacement deliberately has none, so their ABSENCE is part of the AC
   * rather than an incidental detail.
   */
  async hasAnyNoteField() {
    const candidates = await $$(
      'textarea, [data-testid*="note"], [name*="note"], [name*="comment"]'
    )
    return candidates.length > 0
  }

  /**
   * Selected by testid, not by `.govuk-error-summary`, so this cannot latch
   * onto some other error summary that happens to be on the page — and so a
   * restyle of the GOV.UK component does not silently break the assertion.
   */
  errorSummary() {
    return $('[data-testid="duly-making-error-summary"]')
  }

  async hasErrorSummary() {
    return this.errorSummary().isExisting()
  }

  /**
   * Wait for the error summary rather than reading it straight away: the
   * POST re-renders the page, so a bare read can race the navigation and
   * return the pre-submit DOM.
   */
  async assertErrorSummary(expectedMessage) {
    await browser.waitUntil(async () => this.hasErrorSummary(), {
      timeout: 10000,
      timeoutMsg: `Expected a GOV.UK error summary after submitting the duly-making form`
    })
    await expect(this.errorSummary()).toHaveText(
      expect.stringContaining('There is a problem')
    )
    await expect(this.errorSummary()).toHaveText(
      expect.stringContaining(expectedMessage)
    )
  }

  /**
   * Every error link points at the first date field, per the GDS convention
   * management-fe follows. Asserting it stops a regression where the summary
   * renders but its links go nowhere useful.
   */
  async errorSummaryLinkHrefs() {
    const links = await $$('[data-testid="duly-making-error-summary"] a')
    const hrefs = []
    for (const link of links) {
      hrefs.push(await link.getAttribute('href'))
    }
    return hrefs
  }

  async waitForDetailUrl(workItemId) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === `/work-items/${workItemId}`
      },
      {
        timeout: 10000,
        timeoutMsg: `Expected to land on /work-items/${workItemId} after the duly-making flow`
      }
    )
  }

  async waitForDulyMakingUrl(workItemId) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === this.path(workItemId)
      },
      {
        timeout: 10000,
        timeoutMsg: `Expected to stay on ${this.path(workItemId)}`
      }
    )
  }
}

export default new DulyMakingPage()
