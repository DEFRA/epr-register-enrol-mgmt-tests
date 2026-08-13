import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  createReAccreditation,
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'

/**
 * RA-368, re-pointed by RA-410 — CM pushes work item status changes to OJ.
 *
 * Every non-excluded generic work-item transition fires
 * `ReAccreditationStatusPushHook`, which calls OJ's
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
 *     `payment-received` — are unchanged, so the hook still fires on both.
 *     Only the affordance moved, so this drives the CTAs (via the shared
 *     journey helpers) instead of `gotoTasks`/`setTaskStatus`.
 *
 *   - The OUTCOME. This stack used to leave `OperatorBackendApi:Enabled=false`,
 *     so every push was SKIPPED and the deterministic entry was
 *     `status-push-skipped`. RA-410 wires an `operator-backend-stub` into the
 *     compose stack and turns the push ON; the stub answers 200 by default, so
 *     the deterministic outcome is now `status-push-sent`. This is strictly
 *     MORE coverage — the send path the older, disabled spec could not reach
 *     is now the one under test.
 *
 * The two call sites RA-368 cares about both still fire their own push:
 *   - `duly-make` (submitted -> duly-made), and
 *   - `payment-received` (duly-made -> assessment-in-progress).
 *
 * The decision actions (submit-for-decision/approve/reject) are deliberately
 * NOT here: their OJ push is owned by ReAccreditationLogDecisionService as a
 * single pre-commit gate and excluded from this hook — the failure path for
 * that push lives in `ra-410-decision-operator-failure.e2e.js`.
 */
describe('RA-368 CM status push to OJ', () => {
  let workItemId

  before(async () => {
    await login.login()
    // Postcode last-3 ("1SP") unique across the suite for `plastic` — see
    // `createReAccreditation`. Carried over from this spec's task-era version.
    workItemId = await createReAccreditation('Status Push', 'SW1A 1SP')
  })

  after(async () => {
    await login.logout()
  })

  it('records a status-push-sent entry for the duly-make transition', async () => {
    // "Duly make" CTA + payment date page = the submitted -> duly-made
    // transition. The stub answers 200, so the hook records `status-push-sent`.
    await dulyMake(workItemId)

    await workItems.openWorkItem(workItemId)
    await detail.gotoAudit()
    const sentEntries = await detail.auditEntriesForAction('status-push-sent')
    expect(sentEntries.length).toBe(1)
    // Positive control on the human-readable label, not just the action id.
    await detail.assertAuditEntry('Status sent to OJ')
  })

  it('records a second status-push-sent entry for the payment-received action', async () => {
    // "Assign to yourself and start" drives the duly-made ->
    // assessment-in-progress transition, whose action id is `payment-received`
    // (self-assignment fires no push; only the transition does), so this adds
    // exactly one more `status-push-sent` entry.
    await startAssessment(workItemId)

    await workItems.openWorkItem(workItemId)
    await detail.gotoAudit()
    const sentEntries = await detail.auditEntriesForAction('status-push-sent')
    expect(sentEntries.length).toBe(2)
  })
})
