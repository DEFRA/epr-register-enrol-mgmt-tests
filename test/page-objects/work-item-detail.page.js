import { $, expect } from '@wdio/globals'
import { Page } from 'page-objects/page.js'

class WorkItemDetailPage extends Page {
  async assertState(expectedState) {
    await expect(
      $(`//*[contains(@class,"govuk-summary-list__value") and contains(.,"${expectedState}")]`)
    ).toBeDisplayed()
  }

  async assignTo(userId) {
    await $('[data-testid="assign-select"]').selectByAttribute('value', userId)
    await $('[data-testid="assign-submit"]').click()
  }

  async assertAssignedTo(displayName) {
    await expect(
      $(`//*[contains(@class,"govuk-summary-list__value") and contains(.,"${displayName}")]`)
    ).toBeDisplayed()
  }

  async setTaskStatus(task, status) {
    await $(`[data-testid="task-status-select-${task}"]`).selectByAttribute('value', status)
    await $(`[data-testid="set-task-status-${task}"]`).click()
  }

  async assertTaskStatus(task, expectedText) {
    await expect($(`[data-testid="task-status-tag-${task}"]`)).toHaveText(
      expect.stringContaining(expectedText)
    )
  }

  async dulyMake() {
    await $('[data-testid="action-duly-make"]').click()
  }

  async addNote(text) {
    await $('[data-testid="note-text"]').setValue(text)
    await $('[data-testid="add-note-submit"]').click()
  }
}

export default new WorkItemDetailPage()
