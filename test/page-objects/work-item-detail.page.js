import { $, browser, expect } from '@wdio/globals'
import { Page } from 'page-objects/page.js'

class WorkItemDetailPage extends Page {
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
      async () =>
        /\/work-items\/[^/]+\/tasks$/.test(await browser.getUrl()),
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

  async dulyMake() {
    await $('[data-testid="action-duly-make"]').click()
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
   * Submit the approval interstitial form (RA-133).  After
   * triggerAction('approve') the browser is on the GET confirmation
   * page at /work-items/re-accreditation/{id}/approve.  This method
   * clicks the "Approve determination" submit button and waits for the
   * POST-redirect-GET back to the detail page.
   */
  async submitApproval() {
    await $('[data-testid="approval-submit"]').click()
    await browser.waitUntil(
      async () =>
        !/\/approve$/.test(await browser.getUrl()),
      {
        timeout: 10000,
        timeoutMsg: 'Expected redirect away from approval interstitial after submitting approval'
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

  async addNote(text) {
    await $('[data-testid="note-text"]').setValue(text)
    await $('[data-testid="add-note-submit"]').click()
  }
}

export default new WorkItemDetailPage()
