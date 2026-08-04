import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * Shared re-accreditation journey steps (RA-346).
 *
 * Driving a freshly created work item down to `awaiting-decision` takes
 * three states' worth of task completion and two transitions. Both RA-346
 * specs need the same run-up before they can assert anything interesting,
 * and getting a step wrong there would fail the spec for a reason that has
 * nothing to do with the behaviour under test — so the run-up lives here
 * once rather than being copied per spec.
 *
 * The task ids mirror `TASKS_BY_STATE` in management-fe's re-accreditation
 * module (and `ReAccreditationType` in management-be, which is the shared
 * contract). Exported so the specs name the gate they are testing rather
 * than repeating string literals.
 */

export const SUBMITTED_TASKS = [
  'verify-organisation-details',
  'confirm-application-completeness'
]

export const DULY_MADE_TASKS = ['confirm-registration-fee-paid']

/**
 * The `assessment-in-progress` tasks that gate `submit-for-decision`
 * (RA-346 issue 1).
 */
export const ASSESSMENT_TASKS = [
  'review-compliance-history',
  'assess-technical-capacity',
  'assess-financial-capacity'
]

/**
 * The single `awaiting-decision` task that gates `approve` (RA-346 issue
 * 2 — the actual bug: approve ran outside the all-tasks-complete gate).
 */
export const DECISION_TASK = 'record-decision-rationale'

/**
 * Create a re-accreditation work item and return its id.
 *
 * The organisation name is suffixed with a timestamp because the suite
 * shares one backend across specs and the work-items list is searchable by
 * name — a fixed name would make two specs' fixtures indistinguishable.
 */
export async function createReAccreditation(namePrefix) {
  await workItems.goto()
  const { id } = await workItems.createWorkItem({
    organisationName: `${namePrefix} ${Date.now()}`,
    siteAddressLine1: '1 Decision Street',
    siteAddressTown: 'London',
    siteAddressPostcode: 'SW1A 1AA',
    material: 'plastic',
    tonnageBand: '0-500'
  })
  return id
}

async function completeTasks(taskIds) {
  await detail.gotoTasks()
  for (const taskId of taskIds) {
    await detail.setTaskStatus(taskId, 'Completed')
  }
  await detail.gotoDetail()
}

/**
 * Submitted -> Duly made -> Assessment in progress.
 *
 * The submitted -> duly-made hop is an auto-transition that fires when the
 * last submitted task completes (there is no button for it); duly-made ->
 * assessment-in-progress needs the explicit `payment-received` action.
 *
 * Leaves the browser on the detail page with every
 * `assessment-in-progress` task still incomplete — which is exactly the
 * state RA-346 issue 1 is about.
 */
export async function driveToAssessmentInProgress(workItemId) {
  await workItems.openWorkItem(workItemId)
  await completeTasks(SUBMITTED_TASKS)
  await detail.assertState('Duly made')

  await completeTasks(DULY_MADE_TASKS)
  await detail.triggerAction('payment-received')
  // `assessment-in-progress` deliberately displays as "Updated" (RA-324).
  await detail.assertState('Updated')
}

/**
 * Assessment in progress -> Awaiting decision, completing every
 * assessment task first because `submit-for-decision` is gated on them.
 *
 * Leaves the browser on the detail page with `record-decision-rationale`
 * still incomplete — the state RA-346 issue 2 is about.
 */
export async function driveToAwaitingDecision(workItemId) {
  await driveToAssessmentInProgress(workItemId)
  await completeTasks(ASSESSMENT_TASKS)
  await detail.triggerAction('submit-for-decision')
  await detail.assertState('Awaiting decision')
}

export async function completeDecisionTask() {
  await completeTasks([DECISION_TASK])
}
