import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * Task status lifecycle.
 *
 * Existing specs only ever drive tasks straight to Completed. This spec
 * exercises the full status lifecycle for a single task — In progress →
 * Blocked → Completed — via the tasks page.
 *
 * It covers POST /work-items/{id}/tasks/{taskId}/status (driven through
 * the per-task "Set status" select + "Update status" button) and asserts
 * the rendered status tag (`task-status-tag-<taskId>`) changes at each
 * step. The select posts the canonical WorkItemTaskStatus value
 * (`InProgress` | `Blocked` | `Completed`) while the tag renders the
 * human label (`In progress` | `Blocked` | `Completed`).
 *
 * The status-change form only renders while a task is not complete, so
 * Completed is necessarily the final transition; the status tag itself
 * renders for tasks in every state, including Completed.
 */
describe('Task status lifecycle', () => {
  let workItemId

  before(async () => {
    await login.loginAs('assign')
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: `Task Status Lifecycle ${Date.now()}`,
        siteAddressLine1: '1 Lifecycle Street',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AA',
        material: 'plastic',
        tonnageBand: '0-500'
      })
    ).id
    await login.logout()
  })

  describe('In progress → Blocked → Completed', () => {
    before(async () => {
      await login.loginAs('assign')
    })

    after(async () => {
      await login.logout()
    })

    it('moves a task through In progress, Blocked then Completed and updates the status tag each time', async () => {
      const task = 'verify-organisation-details'

      await workItems.openWorkItem(workItemId)
      await detail.gotoTasks()

      await detail.setTaskStatus(task, 'InProgress')
      await detail.assertTaskStatus(task, 'In progress')

      await detail.setTaskStatus(task, 'Blocked')
      await detail.assertTaskStatus(task, 'Blocked')

      await detail.setTaskStatus(task, 'Completed')
      await detail.assertTaskStatus(task, 'Completed')
    })
  })
})
