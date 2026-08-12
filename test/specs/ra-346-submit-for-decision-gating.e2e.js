import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import decision from '../page-objects/decision.page.js'
import {
  createReAccreditation,
  driveToAssessmentInProgress
} from '../support/re-accreditation-journey.js'

/**
 * RA-346 (issue 1), re-pointed by RA-410 — the route to a determination is
 * gated on STATE, not on task completion.
 *
 * WHAT THIS SPEC USED TO ASSERT: that "Submit for decision" was withheld
 * until every `assessment-in-progress` task was complete, that completing two
 * of three did not unlock it, and that a direct POST to
 * `/actions/submit-for-decision` returned 409 while any task was outstanding.
 *
 * WHY IT CHANGED: RA-410 deleted Tasks, so `requiresAllTasksComplete` is gone
 * from every transition and there is no task gate left to test. The file is
 * kept rather than deleted because the UNDERLYING concern survives and is
 * still worth an end-to-end regression: a caseworker must not reach a
 * determination from a state that has no business producing one, and hiding a
 * button is not a control if the route behind it still answers.
 *
 * WHAT IT ASSERTS NOW:
 *   1. `submit-for-decision` is no longer caller-invocable — absent from
 *      `availableActions`, and the generic apply-action route refuses it.
 *   2. The "Log decision" CTA appears ONLY in `assessment-in-progress`.
 *   3. The Log decision route itself refuses from the wrong state, not just
 *      the CTA.
 *
 * management-be now applies `assessment-in-progress -> awaiting-decision ->
 * approved/rejected` inside one call, so `submit-for-decision` has no caller
 * left to invoke it: a manual button parking an item in `awaiting-decision`
 * would strand it, since the Log decision CTA is gated on
 * `assessment-in-progress`.
 */
describe('RA-346/RA-410 The decision route is gated on state, not on tasks', () => {
  let workItemId

  before(async () => {
    await login.login()
    // The postcode must be unique across the whole suite — see
    // `createReAccreditation`. `SW1A 1AG` is unused elsewhere in test/specs.
    workItemId = await createReAccreditation(
      'Submit For Decision Gate',
      'SW1A 1AG'
    )
  })

  after(async () => {
    await login.logout()
  })

  describe('while the item is still in submitted', () => {
    it('does not offer the Log decision CTA', async () => {
      await workItems.openWorkItem(workItemId)
      expect(await detail.hasLogDecisionCta()).toBe(false)
    })

    it('still offers the actions that belong to this state', async () => {
      // Negative control. "Log decision is missing" only means the gate works
      // if the page rendered its actions at all — otherwise a template that
      // failed to render would satisfy every assertion in this file.
      const actionIds = await detail.availableActionIds()
      expect(actionIds).toContain('withdraw')
      expect(actionIds).not.toContain('submit-for-decision')
    })

    it('refuses a direct GET to the Log decision route', async () => {
      // Hiding a CTA is not a control: the route is guessable and has to
      // refuse on its own account.
      await decision.gotoFor(workItemId)

      await expect(browser).not.toHaveUrl(
        expect.stringContaining('/log-decision')
      )
      expect(await decision.hasOutcomeRadio('approved')).toBe(false)
    })

    it('leaves the work item in submitted after the refused GET', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('submitted')
    })
  })

  describe('once the item reaches assessment-in-progress', () => {
    before(async () => {
      await driveToAssessmentInProgress(workItemId)
    })

    it('offers the Log decision CTA', async () => {
      expect(await detail.hasLogDecisionCta()).toBe(true)
    })

    it('still does not offer submit-for-decision or reject as actions', async () => {
      // The transition management-be applies internally must not ALSO be
      // exposed as a button. Two routes to `awaiting-decision`, one of which
      // strands the item there, is the failure mode this guards.
      const actionIds = await detail.availableActionIds()
      expect(actionIds).not.toContain('submit-for-decision')
      expect(actionIds).not.toContain('reject')
      expect(actionIds).toContain('withdraw-during-assessment')
    })

    it('refuses a direct POST to the submit-for-decision apply-action route', async () => {
      // Defence in depth. The action is no longer declared caller-invocable,
      // so the generic route must refuse it rather than quietly applying a
      // transition no affordance offers.
      //
      // The exact status is deliberately not pinned: management-be may treat
      // an undeclared action as a 400 (unknown action) or a 409 (not
      // invocable from here) and both are correct refusals. What this suite is
      // entitled to assert is that it did not succeed.
      const { status } = await detail.postFromPage(
        `/work-items/${workItemId}/actions/submit-for-decision`
      )

      expect(status).toBeGreaterThanOrEqual(400)
    })

    it('leaves the work item in assessment after the rejected POST', async () => {
      // The status code above proves the request was refused; this proves the
      // refusal happened BEFORE any transition was applied.
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('assessment-in-progress')
    })
  })

  describe('once the item is queried away from assessment', () => {
    // The CTA must track the STATE, not merely "this item has been to
    // assessment once". A guard written as a one-way latch would pass every
    // assertion above and fail only here.
    before(async () => {
      await workItems.openWorkItem(workItemId)
      await detail.triggerAction('query-during-assessment')
    })

    it('withdraws the Log decision CTA again', async () => {
      await workItems.openWorkItem(workItemId)
      expect(await detail.hasLogDecisionCta()).toBe(false)
    })
  })
})
