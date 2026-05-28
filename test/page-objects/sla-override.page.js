import { $, browser, expect } from '@wdio/globals'
import { Page } from 'page-objects/page.js'

/**
 * RA-131 — SLA override.
 *
 * Single-step flow:
 *   1. GET  /work-items/{id}/sla/override  — input page (form)
 *   2. POST /work-items/{id}/sla/override  — apply via the backend and
 *                                            redirect back to the work
 *                                            item with a flash banner.
 *
 * Cancel from the input page returns to the detail page without
 * changes. Inputs and buttons are tagged with stable data-testids —
 * see sla-override.njk.
 */
class SlaOverridePage extends Page {
  async gotoFor(workItemId) {
    await this.open(`/work-items/${workItemId}/sla/override`)
    await expect($('[data-testid="sla-override-form"]')).toBeDisplayed()
  }

  async fillForm({ reason, newTargetDays, newStartedAt } = {}) {
    if (reason !== undefined) {
      await $('#field-reason').setValue(reason)
    }
    if (newTargetDays !== undefined) {
      await $('#field-newTargetDays').setValue(String(newTargetDays))
    }
    if (newStartedAt !== undefined) {
      await $('#field-newStartedAt').setValue(newStartedAt)
    }
  }

  async submitForm() {
    await $('[data-testid="sla-override-submit"]').click()
  }

  async cancelFromInputPage() {
    await $('[data-testid="sla-override-cancel"]').click()
  }

  async assertOnInputPage() {
    await expect($('[data-testid="sla-override-form"]')).toBeDisplayed()
  }

  async assertErrorSummaryDisplayed() {
    await expect(
      $('[data-testid="sla-override-error-summary"]')
    ).toBeDisplayed()
  }

  async waitForDetailUrl(workItemId) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === `/work-items/${workItemId}`
      },
      {
        timeout: 10000,
        timeoutMsg: `Expected to land on /work-items/${workItemId} after the SLA override flow`
      }
    )
  }
}

export default new SlaOverridePage()
