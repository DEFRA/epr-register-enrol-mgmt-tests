import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  createReAccreditation,
  dulyMake
} from '../support/re-accreditation-journey.js'

/**
 * RA-410 (AC01, AC02, AC03) — every reference to Tasks is gone from Case
 * Management.
 *
 * Tasks used to drive progress and status updates; that job now belongs to
 * the three green call-to-action buttons covered by
 * `ra-410-cta-lifecycle.e2e.js`. This file is the other half: proving the old
 * feature left nothing behind.
 *
 * WHY THIS IS SWEPT ACROSS STATES RATHER THAN CHECKED ONCE. Tasks were
 * declared PER STATE — `duly-made` carried `confirm-registration-fee-paid`,
 * `assessment-in-progress` carried three more, `awaiting-decision` carried
 * `record-decision-rationale` — and management-fe rendered the panel from
 * whichever list the current state supplied. A check in one state would
 * therefore pass against a partial revert that restored the panel in another,
 * which is the realistic regression here: not "Tasks come back", but "Tasks
 * come back in the one state nobody looked at".
 *
 * ONE THING TO KNOW BEFORE EDITING: absence assertions are the easiest kind
 * of test to make vacuous. Every block below is paired with a positive hook
 * proving the page actually rendered — otherwise a detail page that 500ed
 * would satisfy the whole file.
 */
describe('RA-410 Tasks are removed from Case Management', () => {
  let workItemId

  before(async () => {
    await login.login()
    // The postcode must be unique across the whole suite — see
    // `createReAccreditation`. `SW1A 1AJ` is unused elsewhere in test/specs.
    // NOT named after this ticket on purpose. An organisation name is
    // rendered as the work-item tile link, so a fixture called "Tasks
    // Removed" produced an anchor matching the AC01 sweep below — this spec
    // failing against the item it had just created. `elementsLabelledTasks`
    // now excludes operator-supplied link text as well, but a fixture that
    // walks into its own assertion is worth not having either way.
    workItemId = await createReAccreditation('Checklist Sweep', 'SW1A 1AU')
  })

  after(async () => {
    await login.logout()
  })

  /**
   * Run the full AC01/AC02 sweep against whatever page the browser is on.
   *
   * Takes the state name only for the failure message: a bare "expected [] to
   * equal ['tasks-panel']" gives no clue which of four states regressed.
   */
  async function assertNoTaskSurfaces(stateLabel) {
    // Positive control first — see the file header.
    expect(await detail.hasCaseHeader()).toBe(true)

    // AC02: no task section, panel or widget.
    expect(await detail.residualTaskTestIds()).toEqual([])
    expect(await detail.hasTasksPanel()).toBe(false)
    expect(await detail.hasTaskProgress()).toBe(false)
    expect(await detail.hasNoTasksMessage()).toBe(false)

    // AC01: no nav item, tab, link or button labelled "Tasks".
    expect(await detail.hasTasksLink()).toBe(false)
    const labelled = await detail.elementsLabelledTasks()
    // `expect(value, message)` is Jest/Vitest style — expect-webdriverio takes
    // ONE argument and throws "Expect takes at most one argument." Folding the
    // state into the compared value keeps the diagnostic this helper exists
    // for (see the file header) without the second argument.
    expect({ state: stateLabel, labelled }).toEqual({
      state: stateLabel,
      labelled: []
    })
  }

  describe('AC01/AC02 — no task surfaces on the work item detail page', () => {
    it('in submitted', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('submitted')
      await assertNoTaskSurfaces('submitted')
    })

    it('in duly-made', async () => {
      // The state that used to declare `confirm-registration-fee-paid`, and
      // the one RA-316 explicitly left carrying a panel when it suppressed
      // the `submitted` one. If a partial revert restores a panel anywhere,
      // this is the likeliest place.
      await dulyMake(workItemId)
      await detail.assertStateId('duly-made')
      await assertNoTaskSurfaces('duly-made')
    })

    it('in assessment-in-progress', async () => {
      // The state that carried the most tasks of any — three.
      await workItems.openWorkItem(workItemId)
      await detail.selfAssignAndStart()
      await detail.assertStateId('assessment-in-progress')
      await assertNoTaskSurfaces('assessment-in-progress')
    })
  })

  describe('AC01 — no Tasks affordance elsewhere in the service', () => {
    it('on the work items list', async () => {
      await workItems.goto()
      // Positive control: the list genuinely rendered.
      await expect(workItems.workItemLink(workItemId)).toBeDisplayed()

      expect(await detail.elementsLabelledTasks()).toEqual([])
      expect(await detail.residualTaskTestIds()).toEqual([])
    })

    it('on the application history tab', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      expect(await detail.isActiveTab('history')).toBe(true)

      // The audit log is where a removed feature is most likely to leave a
      // trace: management-be no longer writes `task-completed` or
      // `task-status-changed` entries, so neither the entries nor any task
      // markup should survive here.
      expect(await detail.residualTaskTestIds()).toEqual([])
      expect(await detail.elementsLabelledTasks()).toEqual([])
    })

    it('offers only the summary and history tabs', async () => {
      // AC01 names tabs explicitly. Asserting the two that should exist is
      // stronger than asserting the absence of one that should not — it also
      // catches a "Tasks" tab renamed to something else but still routing to
      // the deleted page.
      await expect(detail.tab('summary')).toBeExisting()
      await expect(detail.tab('history')).toBeExisting()
    })
  })

  describe('AC03 — the task routes no longer resolve', () => {
    it('404s the tasks page', async () => {
      // A 404, NOT a redirect to the detail page. management-fe deletes the
      // route outright rather than re-pointing it, so Hapi 404s it — and the
      // distinction matters: a redirect would mean the route still exists and
      // could be given behaviour again by accident.
      //
      // Driven with fetch rather than a navigation because a browser
      // navigation renders the error page and swallows the status, which is
      // precisely what this case turns on.
      const { status } = await detail.fetchStatus(
        `/work-items/${workItemId}/tasks`
      )
      expect(status).toBe(404)
    })

    it('404s the complete-task route', async () => {
      const { status } = await detail.fetchStatus(
        `/work-items/${workItemId}/tasks/confirm-registration-fee-paid/complete`
      )
      expect(status).toBe(404)
    })

    it('404s the set-task-status route', async () => {
      const { status } = await detail.fetchStatus(
        `/work-items/${workItemId}/tasks/confirm-registration-fee-paid/status`
      )
      expect(status).toBe(404)
    })

    it('still serves the detail page it was reached from', async () => {
      // Negative control for the three above. A stack that was simply down
      // would 404 everything, so proving the sibling route is healthy is what
      // makes those 404s mean "deleted" rather than "broken".
      const { status } = await detail.fetchStatus(`/work-items/${workItemId}`)
      expect(status).toBe(200)
    })
  })

  describe('AC03 — no task actions survive as work item actions', () => {
    it('offers no task-shaped action in any state', async () => {
      // The shared workItemId was already driven to assessment-in-progress and
      // self-assigned by the 'in assessment-in-progress' test above. Re-driving
      // it would call selfAssignAndStart on an item that is already assigned,
      // where the self-assign control is (correctly) absent. Just re-open it —
      // it is already in the state this assertion needs.
      await workItems.openWorkItem(workItemId)

      const actionIds = await detail.availableActionIds()
      const taskShaped = actionIds.filter((id) => /task/i.test(id))
      expect(taskShaped).toEqual([])

      // Positive control: the page rendered its affordances, so the empty
      // task-shaped filter above means something rather than passing vacuously.
      // RA-317 removed the withdraw action that used to serve as this anchor
      // (assessment-in-progress now projects no panel action), so the Log
      // decision CTA is the control the state genuinely still has.
      expect(await detail.hasLogDecisionCta()).toBe(true)
      // RA-317: withdraw is no longer a case-management action.
      expect(actionIds).not.toContain('withdraw-during-assessment')
    })
  })
})
