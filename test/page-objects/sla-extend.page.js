import { $, browser, expect } from '@wdio/globals'
import { Page } from './page.js'

/**
 * RA-131 — SLA extend.
 *
 * Single-step flow:
 *   1. GET  /work-items/{id}/sla/extend  — input page (form)
 *   2. POST /work-items/{id}/sla/extend  — apply via the backend and
 *                                          redirect back to the work
 *                                          item with a flash banner.
 *
 * Cancel from the input page returns to the detail page without
 * changes. Inputs and buttons are tagged with stable data-testids —
 * see the matching .njk template.
 *
 * RA-447 (CM5/CM6), implemented together per the signed-off plan since both
 * land in the same fe files:
 *   - CM5: relabelled "SLA" -> "Determination Deadline" on this page (page
 *     title/heading/breadcrumb, hint, button, success banner).
 *   - CM6: the `additionalDays` count input is replaced with a GOV.UK date
 *     input for the new due date — no upper limit, and the date must be
 *     strictly AFTER the current due date (extension only, never a
 *     reduction). Copied from the duly-making page's existing
 *     govukDateInput + validator pattern (see duly-making.page.js).
 *
 * ASSUMPTION — the date input's field ids. management-fe's CM6
 * implementation lands in a separate repo/PR, so the exact markup isn't
 * visible here. `field-newDueDate-{day,month,year}` follows this repo's own
 * `field-<name>` convention (`#field-reason`, `#field-decisionNote`) with
 * the GOV.UK date-input day/month/year suffix. Confirm against the real
 * markup once that PR lands and adjust here if it differs — same
 * cross-repo coordination note as ra-434-seed.js.
 */
class SlaExtendPage extends Page {
  async gotoFor(workItemId) {
    await this.open(`/work-items/${workItemId}/sla/extend`)
    await expect($('[data-testid="sla-extend-form"]')).toBeDisplayed()
  }

  async fillForm({ reason, date } = {}) {
    if (reason !== undefined) {
      await $('#field-reason').setValue(reason)
    }
    if (date !== undefined) {
      await this.setDate(date)
    }
  }

  dayInput() {
    return $('#field-newDueDate-day')
  }

  monthInput() {
    return $('#field-newDueDate-month')
  }

  yearInput() {
    return $('#field-newDueDate-year')
  }

  /**
   * Fill the new-due-date parts. Any part may be omitted to exercise the
   * incomplete-date branch; parts are cleared first so a re-submit after a
   * validation error does not inherit the previous attempt's digits — same
   * reasoning as duly-making's setPaymentDate().
   */
  async setDate({ day, month, year } = {}) {
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

  async submitForm() {
    await $('[data-testid="sla-extend-submit"]').click()
  }

  /** CM5: the button's visible label, renamed away from "Extend SLA". */
  async submitButtonText() {
    return $('[data-testid="sla-extend-submit"]').getText()
  }

  async cancelFromInputPage() {
    await $('[data-testid="sla-extend-cancel"]').click()
  }

  async assertOnInputPage() {
    await expect($('[data-testid="sla-extend-form"]')).toBeDisplayed()
  }

  /** CM5: the page heading, renamed from "SLA" to "Determination Deadline". */
  async pageHeadingText() {
    return this.pageHeading.getText()
  }

  async assertErrorSummaryDisplayed() {
    await expect($('[data-testid="sla-extend-error-summary"]')).toBeDisplayed()
  }

  async waitForDetailUrl(workItemId) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === `/work-items/${workItemId}`
      },
      {
        timeout: 10000,
        timeoutMsg: `Expected to land on /work-items/${workItemId} after the SLA extend flow`
      }
    )
  }
}

export default new SlaExtendPage()
