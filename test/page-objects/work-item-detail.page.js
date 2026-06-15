import { $, $$, browser, expect } from '@wdio/globals'
import { Page } from './page.js'

/**
 * Build an XPath 1.0 string literal that safely encodes a JS string,
 * including values that contain single quotes, double quotes or both.
 * XPath 1.0 has no escape syntax so mixed-quote strings have to be
 * stitched together with concat().
 */
function toXPathString(value) {
  const s = String(value)
  if (!s.includes("'")) return `'${s}'`
  if (!s.includes('"')) return `"${s}"`
  const parts = s.split("'").map((p) => `'${p}'`)
  return `concat(${parts.join(`, "'", `)})`
}

class WorkItemDetailPage extends Page {
  /**
   * Read the page caption text (RA-196). The caption now shows the
   * user-facing application reference rather than the internal id.
   */
  async getCaption() {
    return $('[data-testid="app-heading-caption"]').getText()
  }

  /**
   * Read a summary list row value by its key label (RA-196). Returns the
   * trimmed text of the value cell whose preceding key cell matches
   * `key` exactly.
   */
  async getSummaryValueByKey(key) {
    const value = $(
      `//*[contains(@class,"govuk-summary-list__key") and normalize-space(.)=${toXPathString(
        key
      )}]/following-sibling::*[contains(@class,"govuk-summary-list__value")]`
    )
    return value.getText()
  }

  /**
   * Whether a summary list row with the given key label exists (RA-196).
   */
  async hasSummaryKey(key) {
    return $(
      `//*[contains(@class,"govuk-summary-list__key") and normalize-space(.)=${toXPathString(
        key
      )}]`
    ).isExisting()
  }

  async assertState(expectedState) {
    await expect(
      $(
        `//*[contains(@class,"govuk-summary-list__value") and contains(.,"${expectedState}")]`
      )
    ).toBeDisplayed()
  }

  async assignTo(userId) {
    await $('[data-testid="assign-select"]').selectByAttribute('value', userId)
    await $('[data-testid="assign-submit"]').click()
  }

  async assertAssignedTo(displayName) {
    await expect(
      $(
        `//*[contains(@class,"govuk-summary-list__value") and contains(.,"${displayName}")]`
      )
    ).toBeDisplayed()
  }

  /**
   * Navigate from the work item detail page to the tasks sub-page.
   * Task status controls live at /work-items/{id}/tasks, not on the
   * detail page itself.
   */
  async gotoTasks() {
    await $('[data-testid="work-item-tasks-link"]').click()
  }

  /**
   * Navigate from the tasks sub-page back to the work item detail page.
   * Extracts the work item id from the current URL.
   */
  async gotoDetail() {
    const url = await browser.getUrl()
    const match = url.match(/\/work-items\/([^/]+)/)
    await this.open(`/work-items/${match[1]}`)
  }

  async setTaskStatus(task, status) {
    await $(`[data-testid="task-status-select-${task}"]`).selectByAttribute(
      'value',
      status
    )
    await $(`[data-testid="set-task-status-${task}"]`).click()
    // Wait for the PRG redirect to land back on the tasks page.  When the
    // full suite runs concurrently the default page-load wait can return
    // before the redirect has fully settled, so we poll the URL explicitly.
    await browser.waitUntil(
      async () => /\/work-items\/[^/]+\/tasks$/.test(await browser.getUrl()),
      {
        timeout: 10000,
        timeoutMsg: `Expected tasks page URL after setting "${task}" to "${status}"`
      }
    )
  }

  async assertTaskStatus(task, expectedText) {
    await expect($(`[data-testid="task-status-tag-${task}"]`)).toHaveText(
      expect.stringContaining(expectedText)
    )
  }

  /**
   * Trigger any work item action by its actionId (RA-133). The action
   * buttons are rendered with `data-testid="action-<actionId>"` so this
   * works for `payment-received`, `submit-for-decision`, `approve`, etc.
   */
  async triggerAction(actionId) {
    await $(`[data-testid="action-${actionId}"]`).click()
  }

  /**
   * Type into the optional decision-note textarea on the approval
   * interstitial (RA-132 / RA-203).
   */
  async setDecisionNote(text) {
    await $('[data-testid="approval-decision-note"]').setValue(text)
  }

  /**
   * Submit the approval interstitial form (RA-133).  After
   * triggerAction('approve') the browser is on the GET confirmation
   * page at /work-items/re-accreditation/{id}/approve.  This method
   * clicks the "Approve determination" submit button and waits for the
   * POST-redirect-GET back to the detail page.
   */
  async submitApproval() {
    await $('[data-testid="approval-submit"]').click()
    await browser.waitUntil(
      async () => !/\/approve$/.test(await browser.getUrl()),
      {
        timeout: 10000,
        timeoutMsg:
          'Expected redirect away from approval interstitial after submitting approval'
      }
    )
  }

  /**
   * Assert that the re-accreditation approval confirmation panel
   * (RA-133) is displayed and exposes the generated accreditation id.
   * Returns the accreditation id text so callers can assert on its
   * format.
   */
  async assertApprovalPanelVisible() {
    await expect(
      $('[data-testid="re-accreditation-approval-panel"]')
    ).toBeDisplayed()
    await expect(
      $('[data-testid="re-accreditation-approval-panel-id"]')
    ).toBeDisplayed()
  }

  async getAccreditationId() {
    return $('[data-testid="re-accreditation-approval-panel-id"]').getText()
  }

  async getAccreditationStartDate() {
    return $(
      '[data-testid="re-accreditation-accreditation-start-date"]'
    ).getText()
  }

  async getAccreditationYear() {
    return $('[data-testid="re-accreditation-accreditation-year"]').getText()
  }

  /**
   * Assert that the re-accreditation "Accreditation issued" success panel
   * (RA-177) renders ABOVE the generic envelope attributes summary in DOM
   * order, with the accreditation metadata between them. Uses an XPath
   * `following::` axis so the assertion is about document order, not
   * pixel position.
   */
  async assertApprovalPanelAboveSummary() {
    // The envelope summary must appear somewhere after the approval panel.
    await expect(
      $(
        '//*[@data-testid="re-accreditation-approval-panel"]' +
          '/following::*[@data-testid="work-item-summary"]'
      )
    ).toExist()
    // The decision metadata must sit between the panel and the summary.
    await expect(
      $(
        '//*[@data-testid="re-accreditation-approval-panel"]' +
          '/following::*[@data-testid="re-accreditation-decision-metadata"]' +
          '/following::*[@data-testid="work-item-summary"]'
      )
    ).toExist()
  }

  async addNote(text) {
    await $('[data-testid="note-text"]').setValue(text)
    await $('[data-testid="add-note-submit"]').click()
  }

  async gotoAudit() {
    await $('[data-testid="work-item-audit-log-link"]').click()
    await browser.waitUntil(
      async () => /\/work-items\/[^/]+\/audit/.test(await browser.getUrl()),
      { timeoutMsg: 'Expected audit log URL after clicking audit link' }
    )
  }

  async assertAuditEntry(action) {
    await expect(
      $(`//*[@data-testid="work-item-audit-log"]//*[contains(.,"${action}")]`)
    ).toBeDisplayed()
  }

  /**
   * Assert the post-redirect flash banner is shown on the detail page
   * (e.g. after an SLA extend/override). Kept here so specs don't reach
   * for the inline selector.
   */
  async assertFlashBanner() {
    await expect($('[data-testid="work-item-flash-banner"]')).toBeDisplayed()
  }

  /**
   * Assert the detail page no longer surfaces the payload pre block or
   * the template version summary row. RA-186 moved the payload into the
   * submitted audit log entry and removed template version from the
   * envelope summary.
   */
  async assertNoPayloadOrTemplateVersionOnDetail() {
    await expect($('[data-testid="work-item-payload"]')).not.toBeExisting()
    await expect(
      $(
        '//*[contains(@class,"govuk-summary-list__key") and normalize-space(.)="Template version"]'
      )
    ).not.toBeExisting()
  }

  /**
   * Expand every "Show details" disclosure on the audit log page so
   * subsequent assertions can match content rendered inside them.
   */
  async expandAllAuditEntryDetails() {
    const disclosures = await $$(
      '[data-testid="work-item-audit-entry-details"]'
    )
    for (const disclosure of disclosures) {
      const isOpen = await disclosure.getAttribute('open')
      if (isOpen === null) {
        await disclosure.$('.govuk-details__summary').click()
      }
    }
  }

  /**
   * Assert the Payload row on the work-item-submitted audit entry
   * contains the given substring. RA-186 surfaces the submission
   * payload inside the submitted entry's disclosure rather than as a
   * stand-alone panel on the detail page.
   *
   * Scoped to the <li data-action="work-item-submitted"> so the
   * assertion cannot pass against a Payload row on a different entry.
   * The substring is XPath-escaped via toXPathString so values that
   * include quotes do not corrupt the locator.
   */
  async assertSubmittedAuditPayloadContains(substring) {
    const needle = toXPathString(substring)
    await expect(
      $(
        `//*[@data-testid="work-item-audit-log"]//li[@data-action="work-item-submitted"]//dt[normalize-space(.)="Payload"]/following-sibling::dd[contains(.,${needle})]`
      )
    ).toBeDisplayed()
  }

  async assertNoTemplateVersionOnAuditLog() {
    await expect(
      $(
        '//*[@data-testid="work-item-audit-log"]//dt[normalize-space(.)="Template version"]'
      )
    ).not.toBeExisting()
  }

  async assertOperatorEmail(email) {
    await expect(
      $(
        `//*[contains(@class,"govuk-summary-list__value") and contains(.,"${email}")]`
      )
    ).toBeDisplayed()
  }
}

export default new WorkItemDetailPage()
