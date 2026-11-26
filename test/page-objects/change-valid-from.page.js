import { $, $$, browser, expect } from '@wdio/globals'
import {
  RE_ACCREDITATION,
  StandardLifecyclePage
} from './standard-lifecycle.page.js'

const SUBMIT_SELECTOR = '[data-testid="change-valid-from-submit"]'

/**
 * RA-800 - change the valid from date after an add-ORS determination is
 * approved, while it awaits "Confirm applicant contact".
 *
 * Reached from the "Change valid from date" link first in the detail page's
 * assignment panel (`change-valid-from-link`):
 *
 *   GET  /work-items/{typeId}/{id}/change-valid-from
 *   POST /work-items/{typeId}/{id}/change-valid-from
 *
 * Same path for GET and POST. Cancel is a plain link back to the detail page
 * and never reaches the backend. Saving redirects to the detail page with an
 * "Updated" flash banner.
 *
 * Selector prefix is `change-valid-from-*`. The date boxes are selected by id
 * (`#effective-date-day|month|year`), the same ids as the Make determination
 * page, because the error-summary links target them. The reason textarea is
 * `#reason`.
 */
class ChangeValidFromPage extends StandardLifecyclePage {
  constructor() {
    super('change-valid-from')
  }

  /** The link on the detail page. */
  link() {
    return $('[data-testid="change-valid-from-link"]')
  }

  async hasLink() {
    return this.link().isExisting()
  }

  async clickLink() {
    await this.link().click()
  }

  async assertOnPage() {
    await expect(this.pageHeading).toHaveText('Change valid from date')
    await expect($(SUBMIT_SELECTOR)).toBeDisplayed()
  }

  /** "The current valid from date is dd/mm/yyyy" */
  async currentValidFromText() {
    return $('[data-testid="change-valid-from-current"]').getText()
  }

  dayInput() {
    return $('#effective-date-day')
  }

  monthInput() {
    return $('#effective-date-month')
  }

  yearInput() {
    return $('#effective-date-year')
  }

  reasonInput() {
    return $('#reason')
  }

  /**
   * Fill the new date. Parts are cleared first so a re-submit after a
   * validation error does not inherit the previous attempt's digits.
   */
  async setValidFromDate({ day, month, year } = {}) {
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

  async readDate() {
    return {
      day: await this.dayInput().getValue(),
      month: await this.monthInput().getValue(),
      year: await this.yearInput().getValue()
    }
  }

  async readReason() {
    return this.reasonInput().getValue()
  }

  async submit() {
    await $(SUBMIT_SELECTOR).click()
  }

  async cancel() {
    await $('[data-testid="change-valid-from-cancel"]').click()
  }

  errorSummary() {
    return $('[data-testid="change-valid-from-error-summary"]')
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
        'Expected a GOV.UK error summary after submitting the change-valid-from form'
    })
    await expect(this.errorSummary()).toHaveText(
      expect.stringContaining('There is a problem')
    )
    await expect(this.errorSummary()).toHaveText(
      expect.stringContaining(expectedMessage)
    )
  }

  async errorSummaryLinkHrefs() {
    const links = await $$('[data-testid="change-valid-from-error-summary"] a')
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
        timeoutMsg: `Expected to land on /work-items/${workItemId} after the change-valid-from flow`
      }
    )
  }

  async waitForChangeValidFromUrl(workItemId, typeId = RE_ACCREDITATION) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === this.path(workItemId, typeId)
      },
      {
        timeout: 10000,
        timeoutMsg: `Expected to be on ${this.path(workItemId, typeId)}`
      }
    )
  }
}

export default new ChangeValidFromPage()
