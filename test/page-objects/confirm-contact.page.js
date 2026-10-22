import { $, browser, expect } from '@wdio/globals'
import { Page } from './page.js'

/**
 * RA-527 — the "Confirm applicant contact" page (step 2 of the two-step
 * determination).
 *
 *   1. "Confirm applicant contact" button on the detail page, while an item
 *      is pending contact (`approved-pending-contact`)
 *   2. GET  /work-items/re-accreditation/{id}/confirm-contact
 *   3. Tick "I have contacted the applicant about the decision"
 *   4. POST /work-items/re-accreditation/{id}/confirm-contact
 *
 * The POST is what APPLIES the determination: management-be pushes the final
 * status to the operator journey first (retrying for up to ~28s if it is
 * slow), then moves the item to Granted, stops the SLA clock, queues
 * publishing and sends the Decision email. On success management-fe
 * redirects to the detail page with a one-time "Applicant contacted" flash.
 *
 * Selected by `data-testid` throughout: those are management-fe's contract
 * with this suite.
 */
class ConfirmContactPage extends Page {
  path(workItemId) {
    return `/work-items/re-accreditation/${workItemId}/confirm-contact`
  }

  /** Navigate straight to the page, bypassing the detail-page button. */
  async gotoFor(workItemId) {
    await this.open(this.path(workItemId))
  }

  async assertOnPage() {
    await expect(this.submitButton()).toBeDisplayed()
  }

  async isOnPage() {
    return this.submitButton().isExisting()
  }

  /** The page H1 (the base Page's `pageHeading`). */
  async headingText() {
    return (await this.pageHeading.getText()).trim()
  }

  /** "Application number: <ref>", the caption under the heading. */
  async captionText() {
    return (await $('[data-testid="app-heading-caption"]').getText()).trim()
  }

  checkbox() {
    return $('[data-testid="confirm-contact-checkbox"]')
  }

  async checkboxLabelText() {
    const id = await this.checkbox().getAttribute('id')
    return (await $(`label[for="${id}"]`).getText()).trim()
  }

  /**
   * Tick the box. GOV.UK checkboxes hide the real `<input>` behind a styled
   * label, so the tick is verified rather than assumed — a silently unticked
   * box would surface as a validation error instead of the confirmation.
   */
  async tickContacted() {
    const box = this.checkbox()
    await box.waitForExist({
      timeout: 10000,
      timeoutMsg:
        'Expected the "I have contacted the applicant" checkbox on the confirm page'
    })
    await box.click()
    await browser.waitUntil(async () => box.isSelected(), {
      timeout: 10000,
      timeoutMsg: 'Expected the confirm-contact checkbox to be ticked'
    })
  }

  submitButton() {
    return $('[data-testid="confirm-contact-submit"]')
  }

  async submitButtonText() {
    return (await this.submitButton().getText()).trim()
  }

  async submit() {
    await this.submitButton().click()
  }

  async isSubmitDisabled() {
    return (await this.submitButton().getAttribute('disabled')) !== null
  }

  async isCheckboxDisabled() {
    return (await this.checkbox().getAttribute('disabled')) !== null
  }

  cancelLink() {
    return $('[data-testid="confirm-contact-cancel"]')
  }

  async cancel() {
    await this.cancelLink().click()
  }

  errorSummary() {
    return $('[data-testid="confirm-contact-error-summary"]')
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
        'Expected a GOV.UK error summary after submitting the confirm-contact form'
    })
    await expect(this.errorSummary()).toHaveText(
      expect.stringContaining('There is a problem')
    )
    if (expectedMessage) {
      await expect(this.errorSummary()).toHaveText(
        expect.stringContaining(expectedMessage)
      )
    }
  }

  /** The inline error rendered against the checkbox itself. */
  inlineError() {
    return $('[data-testid="confirm-contact-error"]')
  }

  async inlineErrorText() {
    return (await this.inlineError().getText()).trim()
  }

  /** The error banner shown when management-be could not apply the outcome. */
  failureBanner() {
    return $('[data-testid="confirm-contact-failure-banner"]')
  }

  /**
   * `timeout` covers the pre-commit operator-journey push, which management-be
   * retries for up to ~28s before it answers.
   */
  async waitForDetailUrl(workItemId, { timeout = 40000 } = {}) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === `/work-items/${workItemId}`
      },
      {
        timeout,
        timeoutMsg: `Expected to land on /work-items/${workItemId} after confirming applicant contact`
      }
    )
  }

  async waitForConfirmUrl(workItemId) {
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

export default new ConfirmContactPage()
