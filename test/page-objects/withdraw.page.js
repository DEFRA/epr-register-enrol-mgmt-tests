import { $, browser, expect } from '@wdio/globals'
import { Page } from './page.js'

/**
 * RA-188 — Withdraw confirmation interstitial.
 *
 * Two endpoints:
 *   1. GET  /work-items/{id}/actions/{actionId}/confirm — confirmation
 *      page with an optional note field and Cancel link
 *   2. POST /work-items/{id}/actions/{actionId}/confirm — applies the
 *      withdraw transition and PRG-redirects back to the work item
 */
class WithdrawPage extends Page {
  async gotoFor(workItemId, actionId = 'withdraw') {
    await this.open(`/work-items/${workItemId}/actions/${actionId}/confirm`)
    await expect($('[data-testid="withdraw-form"]')).toBeDisplayed()
  }

  async fillNote(text) {
    if (text !== undefined) {
      await $('#field-note').setValue(text)
    }
  }

  async submit() {
    await $('[data-testid="withdraw-submit"]').click()
  }

  async cancel() {
    await $('[data-testid="withdraw-cancel"]').click()
  }

  async assertOnConfirmPage() {
    await expect($('[data-testid="withdraw-form"]')).toBeDisplayed()
    await expect($('[data-testid="withdraw-warning"]')).toBeDisplayed()
  }

  async assertErrorSummaryDisplayed() {
    await expect($('[data-testid="withdraw-error-summary"]')).toBeDisplayed()
  }

  async waitForDetailUrl(workItemId) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === `/work-items/${workItemId}`
      },
      {
        timeout: 10000,
        timeoutMsg: `Expected to land on /work-items/${workItemId} after the withdraw flow`
      }
    )
  }
}

export default new WithdrawPage()
