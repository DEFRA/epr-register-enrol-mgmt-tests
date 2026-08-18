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
 */
class SlaExtendPage extends Page {
  /**
   * RA-351 — the "Change the due date" entry point in the work-item detail
   * page's assignment panel.
   *
   * This link lives in the ASSIGNMENT panel, gated on `canChangeDueDate`, and
   * is deliberately filtered out of the actions panel's `availableActions`
   * (see work-item-detail.page.js `availableActionIds()`), so it never passes
   * through the workflow engine's action gate. RA-351 makes `canChangeDueDate`
   * true in the `queried` state, where it was previously hidden.
   */
  actionLink() {
    return $('[data-testid="action-sla-extend"]')
  }

  /**
   * RA-351 (AC1). Assert the assignment-panel "Change the due date" link is
   * present and points at the extend flow for this work item.
   */
  async assertActionLinkFor(workItemId) {
    await expect(this.actionLink()).toBeDisplayed()
    const href = await this.actionLink().getAttribute('href')
    expect(href).toContain(`/work-items/${workItemId}/sla/extend`)
  }

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
