import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { dulyMake } from '../support/re-accreditation-journey.js'

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
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: `Task Status Lifecycle ${Date.now()}`,
        siteAddressLine1: '1 Lifecycle Street',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AW',
        material: 'plastic',
        tonnageBand: '0-500'
      })
    ).id
    await login.logout()
  })

  describe('In progress → Blocked → Completed', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('moves a task through In progress, Blocked then Completed and updates the status tag each time', async () => {
      // RA-316 deleted the `submitted` tasks this used to drive, and the
      // whole tasks panel with them, so the item is first taken to
      // `duly-made` — the nearest state that still declares a task.
      //
      // `confirm-registration-fee-paid` is deliberately the SINGLE task of
      // that state: this spec is about one task's status tag moving through
      // the lifecycle, and a single-task state keeps the assertion about
      // that and nothing else. Completing it does not transition the item
      // (`payment-received` is a separate explicit action), so Completed
      // remains a legitimate final status to land on here.
      const task = 'confirm-registration-fee-paid'

      await dulyMake(workItemId)
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
