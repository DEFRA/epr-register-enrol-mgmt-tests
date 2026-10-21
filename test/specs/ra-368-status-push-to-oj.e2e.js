import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'
import {
  createOperatorBackedWorkItem,
  waitForOperatorApplicationStatus
} from '../support/operator-backend-api.js'

/**
 * RA-368, re-pointed by RA-410 — Case Management service pushes work item status changes to the Registration & Accreditation service.
 *
 * Every non-excluded generic work-item transition fires
 * `ReAccreditationStatusPushHook`, which calls the Registration & Accreditation service's
 * `case-management/{workItemId}/status` endpoint and records the outcome as a
 * `status-push-sent` / `status-push-skipped` / `status-push-failed` audit
 * entry.
 *
 * TWO THINGS RA-410 CHANGED under this spec — the assertions moved, the
 * behaviour under test did not:
 *
 *   - HOW the transitions are triggered. `duly-made` and
 *     `assessment-in-progress` used to be reached by completing per-state task
 *     checklists; they are now the "Duly make" + payment CTA and the "Assign
 *     to yourself and start" CTA. The TRANSITIONS themselves — `duly-make` and
 *     the start step (RA-595: `start-assessment`) — still fire the hook.
 *     Only the affordance moved, so this drives the CTAs (via the shared
 *     journey helpers) instead of `gotoTasks`/`setTaskStatus`.
 *
 *   - The OUTCOME. This stack used to leave `OperatorBackendApi:Enabled=false`,
 *     so every push was SKIPPED and the deterministic entry was
 *     `status-push-skipped`. The push is now ON, to the real Registration &
 *     Accreditation service backend, so the outcome is `status-push-sent`.
 *
 * RA-000: the item is submitted through that backend
 * (`createOperatorBackedWorkItem`), so it is an application the backend owns
 * and the push is genuinely accepted rather than 404'd. That also lets the
 * spec read the backend's own copy of the application back and prove each
 * push landed: its `applicationStatus` follows the case-management state.
 *
 * The two call sites RA-368 cares about both still fire their own push:
 *   - `duly-make` (submitted -> duly-made), and
 *   - `start-assessment` (duly-made -> assessment-in-progress; RA-595).
 *
 * The decision actions (submit-for-decision/approve/reject) are deliberately
 * NOT here: their Registration & Accreditation service push is owned by ReAccreditationLogDecisionService as a
 * single pre-commit gate and excluded from this hook. The failure path for
 * that push is covered by management-be's integration tests
 * (ReAccreditationEndpointTests), against a failing fake of that service.
 */
// eslint-disable-next-line local-rules/no-undocumented-service-acronyms -- verbatim Jira ticket title, predates this guard
describe('RA-368 CM status push to OJ', () => {
  let workItemId
  let application

  before(async () => {
    await login.login()
    application = await createOperatorBackedWorkItem()
    workItemId = application.id
  })

  after(async () => {
    await login.logout()
  })

  it('records a status-push-sent entry for the duly-make transition', async () => {
    // "Duly make" CTA + payment date page = the submitted -> duly-made
    // transition. The backend accepts it, so the hook records
    // `status-push-sent`.
    await dulyMake(workItemId)

    await workItems.openWorkItem(workItemId)
    await detail.gotoAudit()
    // RA-519 defers this push onto a background task queue, so it can still
    // be in flight when the duly-make request itself has already returned -
    // poll for it rather than checking once.
    const sentEntries = await detail.waitForAuditEntryCount(
      'status-push-sent',
      1
    )
    expect(sentEntries.length).toBe(1)
    // Positive control on the human-readable label, not just the action id.
    await detail.assertAuditEntry(
      'Status sent to the Registration & Accreditation service'
    )
  })

  it('moves the Registration & Accreditation service application to Duly made', async () => {
    const pushed = await waitForOperatorApplicationStatus(
      application,
      'DulyMade'
    )
    expect(pushed.caseManagementStatusUpdatedAt).toBeTruthy()
  })

  it('records a second status-push-sent entry for the start-assessment action', async () => {
    // "Assign to yourself and start" drives the duly-made ->
    // assessment-in-progress transition, whose action id is `start-assessment`
    // (self-assignment fires no push; only the transition does), so this adds
    // exactly one more `status-push-sent` entry.
    await startAssessment(workItemId)

    await workItems.openWorkItem(workItemId)
    await detail.gotoAudit()
    const sentEntries = await detail.waitForAuditEntryCount(
      'status-push-sent',
      2
    )
    expect(sentEntries.length).toBe(2)
  })

  it('moves the Registration & Accreditation service application on from Duly made', async () => {
    // assessment-in-progress has no status of its own on that side; it
    // reads as Updated.
    await waitForOperatorApplicationStatus(application, 'Updated')
  })
})
