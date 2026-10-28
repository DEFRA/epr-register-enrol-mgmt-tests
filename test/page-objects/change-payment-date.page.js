import { $, $$, browser, expect } from '@wdio/globals'
import { Page } from './page.js'

const SUBMIT_SELECTOR = '[data-testid="change-payment-date-submit"]'

/**
 * RA-576 — change the payment date after an application is duly made.
 *
 * Reached from the "Change payment date" link in the detail page's side
 * panel:
 *
 *   GET  /work-items/re-accreditation/{id}/change-payment-date
 *   POST /work-items/re-accreditation/{id}/change-payment-date
 *
 * Same path for GET and POST, and the same `re-accreditation` segment as
 * duly making, because the page is module-specific. Cancel is a plain link
 * back to the detail page and never reaches the backend.
 *
 * Selector prefix is `change-payment-date-*`. The date boxes are selected by
 * id (`#payment-date-day|month|year`) because the error-summary links target
 * them, exactly as on the duly-making page.
 */
class ChangePaymentDatePage extends Page {
  path(workItemId) {
    return `/work-items/re-accreditation/${workItemId}/change-payment-date`
  }

  /** Navigate straight to the page, bypassing the link. */
  async gotoFor(workItemId) {
    await this.open(this.path(workItemId))
  }

  async assertOnPage() {
    await expect(this.pageHeading).toHaveText('Change payment date')
    await expect($(SUBMIT_SELECTOR)).toBeDisplayed()
  }

  /** "The current payment date is dd/mm/yyyy" */
  async currentPaymentDateText() {
    return $('[data-testid="change-payment-date-current"]').getText()
  }

  dayInput() {
    return $('#payment-date-day')
  }

  monthInput() {
    return $('#payment-date-month')
  }

  yearInput() {
    return $('#payment-date-year')
  }

  reasonInput() {
    return $('#reason')
  }

  /**
   * Fill the payment date. Parts are cleared first so a re-submit after a
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

  async setReason(text) {
    await this.reasonInput().setValue('')
    if (text) {
      await this.reasonInput().setValue(text)
    }
  }

  async submit() {
    await $(SUBMIT_SELECTOR).click()
  }

  async cancel() {
    await $('[data-testid="change-payment-date-cancel"]').click()
  }

  async submitButtonText() {
    return $(SUBMIT_SELECTOR).getText()
  }

  errorSummary() {
    return $('[data-testid="change-payment-date-error-summary"]')
  }

  async hasErrorSummary() {
    return this.errorSummary().isExisting()
  }

  /**
   * Wait for the error summary rather than reading it straight away: the
   * POST re-renders the page, so a bare read can race the navigation.
   */
  async assertErrorSummary(expectedMessage) {
    await browser.waitUntil(async () => this.hasErrorSummary(), {
      timeout: 10000,
      timeoutMsg:
        'Expected a GOV.UK error summary after submitting the change-payment-date form'
    })
    await expect(this.errorSummary()).toHaveText(
      expect.stringContaining('There is a problem')
    )
    await expect(this.errorSummary()).toHaveText(
      expect.stringContaining(expectedMessage)
    )
  }

  async errorSummaryLinkHrefs() {
    const links = await $$(
      '[data-testid="change-payment-date-error-summary"] a'
    )
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
        timeoutMsg: `Expected to land on /work-items/${workItemId} after the change-payment-date flow`
      }
    )
  }

  async waitForChangePaymentDateUrl(workItemId) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === this.path(workItemId)
      },
      {
        timeout: 10000,
        timeoutMsg: `Expected to be on ${this.path(workItemId)}`
      }
    )
  }
}

export default new ChangePaymentDatePage()
