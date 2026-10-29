import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  confirmApplicantContact,
  dulyMake,
  logDecision,
  startAssessment
} from '../support/re-accreditation-journey.js'
import {
  createOperatorBackedWorkItem,
  getOperatorApplication,
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
 * RA-368 originally covered two call sites; only one still pushes:
 *   - `duly-make` (submitted -> duly-made) fires its own push, and
 *   - `start-assessment` (duly-made -> assessment-started; RA-527 follow-up)
 *     is excluded from the hook, so it pushes nothing and records no
 *     `status-push-sent` entry. A started case stays "Duly made" on both
 *     sides.
 *
 * The decision actions are NOT pushed by this hook: their Registration &
 * Accreditation service push is a single pre-commit gate owned by the service
 * that applies the outcome. RA-527 moved it for both outcomes: the determination
 * (step 1) pushes nothing at all, and the push happens when applicant contact
 * is confirmed (step 2) — the approval cases below, and the refusal describe
 * at the end. The failure path for
 * that push is covered by management-be's integration tests
 * (ReAccreditationEndpointTests), against a failing fake of that service.
 */
// eslint-disable-next-line local-rules/no-undocumented-service-acronyms -- verbatim Jira ticket title, predates this guard
describe('RA-368 CM status push to OJ', () => {
  let workItemId
  let application
  let dulyMadePushedAt

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
    dulyMadePushedAt = pushed.caseManagementStatusUpdatedAt
  })

  // RA-527 follow-up: starting a case keeps it "Duly made" on both sides.
  // "Assign to yourself and start" applies `start-assessment`, which now
  // lands on `assessment-started` — labelled "Duly made", purple badge — and
  // is never pushed, so no `status-push-sent` entry is added.
  it('keeps a started case Duly made in the Case Management service and pushes nothing for the start', async () => {
    await startAssessment(workItemId)

    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('assessment-started')
    await detail.assertState('Duly made')
    await detail.assertStateTagClass('govuk-tag--purple')

    await detail.gotoAudit()
    // The start is still recorded in the history...
    await detail.assertAuditEntry('Assessment started')
    // ...but only the duly-make push is there.
    const sentEntries = await detail.waitForAuditEntryCount(
      'status-push-sent',
      1
    )
    expect(sentEntries.length).toBe(1)
  })

  it('leaves the Registration & Accreditation service application on Duly made after the start', async () => {
    const operatorApplication = await getOperatorApplication(
      application.operatorOrganisationId,
      application.operatorApplicationId
    )
    expect(operatorApplication.applicationStatus).toBe('DulyMade')
    // Not re-pushed: the last Case Management status update is still the
    // duly-make one.
    expect(operatorApplication.caseManagementStatusUpdatedAt).toBe(
      dulyMadePushedAt
    )
  })

  it('pushes nothing for an approved determination (RA-527 step 1)', async () => {
    await logDecision(workItemId, 'approved')

    await detail.gotoAudit()
    // Still just the duly-make push.
    const sentEntries = await detail.waitForAuditEntryCount(
      'status-push-sent',
      1
    )
    expect(sentEntries.length).toBe(1)
    const operatorApplication = await getOperatorApplication(
      application.operatorOrganisationId,
      application.operatorApplicationId
    )
    expect(operatorApplication.applicationStatus).toBe('DulyMade')
  })

  it('pushes the outcome when applicant contact is confirmed (RA-527 step 2)', async () => {
    await confirmApplicantContact(workItemId)

    await detail.gotoAudit()
    const sentEntries = await detail.waitForAuditEntryCount(
      'status-push-sent',
      2
    )
    expect(sentEntries.length).toBe(2)
    // Approved on that side, which the operator sees as GRANTED.
    await waitForOperatorApplicationStatus(application, 'Approved')
  })
})

// RA-527 (task 005). A refusal follows the same two steps: the determination
// pushes nothing, and the operator only sees REFUSED once applicant contact
// is confirmed. Starting the case pushes nothing either, so the operator sits
// on DulyMade from the duly-make push until step 2.
describe('RA-368 status push to the Registration & Accreditation service: a refusal', () => {
  let workItemId
  let application

  before(async () => {
    await login.login()
    application = await createOperatorBackedWorkItem()
    workItemId = application.id
    await dulyMake(workItemId)
    // The duly-make push runs in the background (RA-519): let it land before
    // starting, so the push count below is deterministic.
    await waitForOperatorApplicationStatus(application, 'DulyMade')
    await startAssessment(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('pushes nothing for a refused determination (RA-527 step 1)', async () => {
    await logDecision(workItemId, 'refused')

    await detail.gotoAudit()
    // Still just the duly-make push: the start pushed nothing.
    const sentEntries = await detail.waitForAuditEntryCount(
      'status-push-sent',
      1
    )
    expect(sentEntries.length).toBe(1)
    const operatorApplication = await getOperatorApplication(
      application.operatorOrganisationId,
      application.operatorApplicationId
    )
    expect(operatorApplication.applicationStatus).toBe('DulyMade')
  })

  it('pushes the refusal when applicant contact is confirmed (RA-527 step 2)', async () => {
    await confirmApplicantContact(workItemId)

    await detail.gotoAudit()
    const sentEntries = await detail.waitForAuditEntryCount(
      'status-push-sent',
      2
    )
    expect(sentEntries.length).toBe(2)
    // Rejected on that side, which the operator sees as REFUSED.
    await waitForOperatorApplicationStatus(application, 'Rejected')
  })
})
