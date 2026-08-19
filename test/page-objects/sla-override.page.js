import { $, browser, expect } from '@wdio/globals'
import { Page } from './page.js'

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
 *
 * RA-447 (CM9): relabelled "Override SLA" -> "Override determination
 * deadline" (page heading, reason field label + hint, submit button).
 * `data-testid`s are unchanged — CM5 did not touch this page (it explicitly
 * excluded Override), so CM9 is the first rename here. The label/hint
 * getters below select by GOV.UK's own `label[for=]` / `${id}-hint`
 * convention rather than a testid, since none exists for either — same
 * approach as sla-extend.page.js's field-reason.
 */
class SlaOverridePage extends Page {
  /**
   * RA-351 — the "Override the due date" entry point in the work-item detail
   * page's assignment panel.
   *
   * Like its extend sibling this link lives in the ASSIGNMENT panel, gated on
   * `canChangeDueDate` and filtered out of the actions panel's
   * `availableActions` (see work-item-detail.page.js `availableActionIds()`).
   * RA-351 makes `canChangeDueDate` true in the `queried` state.
   */
  actionLink() {
    return $('[data-testid="action-sla-override"]')
  }

  /**
   * RA-351 (AC1). Assert the assignment-panel "Override the due date" link is
   * present and points at the override flow for this work item.
   */
  async assertActionLinkFor(workItemId) {
    await expect(this.actionLink()).toBeDisplayed()
    const href = await this.actionLink().getAttribute('href')
    expect(href).toContain(`/work-items/${workItemId}/sla/override`)
  }

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

  /** CM9: the button's visible label, renamed away from "Override SLA". */
  async submitButtonText() {
    return $('[data-testid="sla-override-submit"]').getText()
  }

  /** CM9: the page heading, renamed from "Override SLA". */
  async pageHeadingText() {
    return this.pageHeading.getText()
  }

  /** CM9: the reason field's label, renamed from "...overriding the SLA". */
  async reasonLabelText() {
    return $('label[for="field-reason"]').getText()
  }

  /** CM9: the reason field's hint, renamed away from "the SLA clock". */
  async reasonHintText() {
    return $('#field-reason-hint').getText()
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
