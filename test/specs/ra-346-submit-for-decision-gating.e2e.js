import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  ASSESSMENT_TASKS,
  createReAccreditation,
  driveToAssessmentInProgress
} from '../support/re-accreditation-journey.js'

/**
 * RA-346 (issue 1) — "Submit for decision" is gated on task completion.
 *
 * The reported bug was that "Submit for decision seems redundant" now the
 * regulator RBACs are gone. The team's decision (confirmed with Tom) is
 * that the button STAYS but is only offered once every
 * `assessment-in-progress` task is complete — it is not being replaced by
 * an automatic transition, so a spec asserting an auto-hop to
 * `awaiting-decision` would be asserting the wrong design.
 *
 * The `submit-for-decision` transition carries
 * `requiresAllTasksComplete: true`, so it is withheld from
 * `availableActions` while any assessment task is outstanding and the
 * affordance is ABSENT rather than disabled — distinct from the read-only
 * support-user case (RA-335), where controls render inert.
 *
 * On the rendered detail page that filtering is done by the BACKEND, not
 * the frontend: the detail controller's `decorate` passes `availableActions`
 * through verbatim and never calls `projectWorkItem`, so the frontend
 * engine's equivalent filter is not what is being exercised here
 * (confirmed with the management-fe owner). Stated explicitly because the
 * frontend DOES gate `approve` in the sibling RA-346 spec, and assuming the
 * same mechanism covers both would be wrong.
 *
 * This is the end-to-end regression for that gate; management-fe and
 * management-be carry the unit-level ones.
 */
describe('RA-346 Submit for decision is gated on assessment task completion', () => {
  let workItemId

  before(async () => {
    await login.login()
    // The postcode must be unique across the whole suite — see
    // `createReAccreditation`. `SW1A 1AG` is unused elsewhere in test/specs.
    workItemId = await createReAccreditation(
      'Submit For Decision Gate',
      'SW1A 1AG'
    )
    await driveToAssessmentInProgress(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('does not offer Submit for decision while every assessment task is outstanding', async () => {
    expect(await detail.hasAction('submit-for-decision')).toBe(false)
  })

  it('still offers the actions that are not gated on task completion', async () => {
    // Negative control. "Submit for decision is missing" only means the
    // gate works if the actions panel rendered at all — otherwise a
    // template that failed to render would pass the assertion above.
    //
    // `withdraw-during-assessment` is the control because it is
    // `requiresAllTasksComplete: false` AND genuinely comes from
    // `availableActions`. Deliberately NOT `sla-extend`: despite its
    // `action-` testid it is rendered by the assignment panel and is
    // filtered out of `availableActions` by the detail controller, so it
    // would still be present even if the actions panel vanished — a
    // control that cannot fail is not a control.
    const actionIds = await detail.availableActionIds()
    expect(actionIds).toContain('withdraw-during-assessment')
    expect(actionIds).not.toContain('submit-for-decision')
  })

  it('still does not offer it when only some assessment tasks are complete', async () => {
    // The gate is "all tasks", not "any task" — completing two of three
    // must not unlock it. This is the assertion that would catch a
    // predicate accidentally written as `.some()` instead of `.every()`.
    await detail.gotoTasks()
    await detail.setTaskStatus(ASSESSMENT_TASKS[0], 'Completed')
    await detail.setTaskStatus(ASSESSMENT_TASKS[1], 'Completed')
    await detail.gotoDetail()

    expect(await detail.hasAction('submit-for-decision')).toBe(false)
  })

  it('rejects a direct POST to the apply-action route with 409 while a task is outstanding', async () => {
    // Defence in depth. Hiding the button is a UI affordance; the route
    // behind it has to refuse too, or a stale form or a crafted request
    // walks straight through the gate.
    //
    // Enforced by the BACKEND, which rejects with 409 while any
    // `assessment-in-progress` task is outstanding. The frontend only
    // surfaces that 409 — `toResult` maps the status to a `not-allowed`
    // reason and the detail controller re-renders with it. There is no
    // independent frontend gate on this path: `canApplyAction` exists but
    // has a single production caller, the `approve` eligibility check,
    // which is a different action entirely. That asymmetry is why the
    // sibling RA-346 approve spec can assert a frontend-rendered guard and
    // this one cannot. (Chain verified by the management-fe owner.)
    //
    // Unlike the approve route, this one does NOT redirect: the generic
    // apply-action route re-renders the detail page in place with an error
    // notice, so the status is readable directly.
    const { status } = await detail.postFromPage(
      `/work-items/${workItemId}/actions/submit-for-decision`
    )

    expect(status).toBe(409)
  })

  it('leaves the work item in assessment after the rejected POST', async () => {
    // The status code above proves the request was refused; this proves
    // the refusal happened BEFORE the transition was applied.
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Updated')
  })

  it('offers Submit for decision once the last assessment task completes, and the transition works', async () => {
    await detail.gotoTasks()
    await detail.setTaskStatus(ASSESSMENT_TASKS[2], 'Completed')
    await detail.gotoDetail()

    expect(await detail.hasAction('submit-for-decision')).toBe(true)

    await detail.triggerAction('submit-for-decision')
    await detail.assertState('Awaiting decision')
  })
})
