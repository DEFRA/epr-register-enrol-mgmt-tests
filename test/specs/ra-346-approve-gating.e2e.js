import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  completeDecisionTask,
  createReAccreditation,
  driveToAwaitingDecision
} from '../support/re-accreditation-journey.js'

/**
 * RA-346 (issue 2) — a determination cannot be approved while the
 * `record-decision-rationale` task is still pending.
 *
 * This is the real defect behind the ticket. `approve` is declared with
 * `requiresAllTasksComplete: true` like every other decision transition,
 * but it is not reached through the generic apply-action route: the
 * re-accreditation module renders a bespoke "Approve" CTA
 * (`re-accreditation-approve-cta`) pointing at its own interstitial at
 * `/work-items/re-accreditation/{id}/approve`, and that flow sat outside
 * the engine's all-tasks-complete gate. A caseworker could therefore grant
 * an accreditation without ever recording the rationale for the decision.
 *
 * Three layers have to hold, and this spec asserts all three, because any
 * one of them alone is bypassable:
 *
 *   1. the CTA is not rendered while the task is pending;
 *   2. the interstitial route refuses a direct GET, so typing the URL in
 *      does not hand out the approve form;
 *   3. the POST refuses, so a stale or crafted form cannot apply the
 *      transition — and the work item is still in `awaiting-decision`
 *      afterwards, proving the refusal preceded the transition.
 *
 * Once the task is complete the CTA returns and the existing RA-133
 * approval journey must still work end to end — the gate must not have
 * been implemented by simply breaking approve.
 */
describe('RA-346 Approve is gated on the decision rationale task', () => {
  let workItemId

  before(async () => {
    await login.login()
    workItemId = await createReAccreditation('Approve Decision Gate')
    await driveToAwaitingDecision(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  describe('while record-decision-rationale is pending', () => {
    it('does not render the Approve determination CTA', async () => {
      expect(await detail.hasApproveCta()).toBe(false)
      expect(await detail.hasAction('approve')).toBe(false)
    })

    it('does not render the Reject CTA either', async () => {
      // `reject` carries the same `requiresAllTasksComplete: true` gate
      // from the same state. Asserting it too keeps a fix that special-
      // cases only the approve path from passing as complete.
      expect(await detail.hasAction('reject')).toBe(false)
    })

    it('still offers the actions that are not gated on task completion', async () => {
      // Negative control — see the RA-346 submit-for-decision spec. Without
      // this, a detail page that failed to render its actions panel at all
      // would satisfy every assertion above.
      const actionIds = await detail.availableActionIds()
      expect(actionIds).toContain('withdraw-during-decision')
      expect(actionIds).not.toContain('approve')
    })

    it('does not serve the approval interstitial on a direct GET', async () => {
      // Hiding the CTA is not a control: the route is guessable and was
      // previously reachable by URL alone. Whatever the guard renders, the
      // one thing that must never appear is the approve form itself.
      await detail.openApprovePathDirectly(workItemId)

      await expect($('[data-testid="approval-submit"]')).not.toBeExisting()
      await expect(
        $('[data-testid="approval-decision-note"]')
      ).not.toBeExisting()
    })

    it('rejects a direct POST to the approve route', async () => {
      await workItems.openWorkItem(workItemId)

      const status = await detail.postFromPage(detail.approvePath(workItemId))

      expect(status).toBeGreaterThanOrEqual(400)
    })

    it('leaves the work item awaiting decision, with no accreditation issued', async () => {
      // The refusal has to happen before the transition is applied. A
      // guard that rejected the response but had already granted the
      // accreditation would still be the bug in the ticket.
      await workItems.openWorkItem(workItemId)

      await detail.assertState('Awaiting decision')
      await expect(
        $('[data-testid="re-accreditation-approval-panel"]')
      ).not.toBeExisting()
    })
  })

  describe('once record-decision-rationale is complete', () => {
    before(async () => {
      await workItems.openWorkItem(workItemId)
      await completeDecisionTask()
    })

    it('renders the Approve determination CTA', async () => {
      expect(await detail.hasApproveCta()).toBe(true)
      expect(await detail.hasAction('approve')).toBe(true)
    })

    it('approves the determination and issues an accreditation', async () => {
      // The gate must not have been implemented by breaking approve: the
      // RA-133 journey has to still complete, panel and all.
      await detail.triggerAction('approve')
      await detail.submitApproval()

      await detail.assertState('Granted')
      await detail.assertApprovalPanelVisible()
      expect(await detail.getAccreditationId()).toMatch(
        /^ACC-\d{4}-P-[A-Z0-9]{8}$/
      )
    })
  })
})
