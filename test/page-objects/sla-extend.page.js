import { $, browser, expect } from '@wdio/globals'
import { Page } from 'page-objects/page.js'

/**
 * RA-131 — SLA extend two-step wizard.
 *
 * The flow has three URLs:
 *   1. GET  /work-items/{id}/sla/extend          — input page (form)
 *   2. POST /work-items/{id}/sla/extend          — validate and render
 *                                                  the confirmation page
 *   3. POST /work-items/{id}/sla/extend/confirm  — apply the change and
 *                                                  redirect back to the
 *                                                  work item with a flash
 *                                                  banner.
 *
 * Cancel from either step returns to the detail page without changes.
 * Inputs and buttons are tagged with stable data-testids — see the
 * matching .njk templates.
 */
class SlaExtendPage extends Page {
  async gotoFor(workItemId) {
    await this.open(`/work-items/${workItemId}/sla/extend`)
    await expect($('[data-testid="sla-extend-form"]')).toBeDisplayed()
  }

  async fillForm({ reason, additionalDays }) {
    if (reason !== undefined) {
      await $('#field-reason').setValue(reason)
    }
    if (additionalDays !== undefined) {
      await $('#field-additionalDays').setValue(String(additionalDays))
    }
  }

  async submitForm() {
    await $('[data-testid="sla-extend-submit"]').click()
  }

  async cancelFromInputPage() {
    await $('[data-testid="sla-extend-cancel"]').click()
  }

  async assertOnInputPage() {
    await expect($('[data-testid="sla-extend-form"]')).toBeDisplayed()
  }

  async assertOnConfirmPage() {
    await expect($('[data-testid="sla-extend-confirm-form"]')).toBeDisplayed()
  }

  async assertConfirmSummaryHas(text) {
    await expect($('[data-testid="sla-extend-confirm-summary"]')).toHaveText(
      expect.stringContaining(text)
    )
  }

  async confirm() {
    await $('[data-testid="sla-extend-confirm-submit"]').click()
  }

  async cancelFromConfirmPage() {
    await $('[data-testid="sla-extend-confirm-cancel"]').click()
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
