import { $, browser, expect } from '@wdio/globals'
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
    // Distinct from the RA-346 submit-for-decision spec's postcode on
    // purpose — see `createReAccreditation`. `SW1A 1AE` is unused elsewhere.
    workItemId = await createReAccreditation(
      'Approve Decision Gate',
      'SW1A 1AE'
    )
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

    it('bounces a direct GET back to the detail page instead of serving the approval interstitial', async () => {
      // Hiding the CTA is not a control: the route is guessable and was
      // previously reachable by URL alone.
      //
      // The guard follows this app's established PRG + flash-banner
      // convention (as withdraw, query and SLA already do) rather than
      // returning a 4xx error page — it 302s to /work-items/{id}. Driving
      // this with a real navigation rather than fetch is deliberate: the
      // browser follows the redirect and consumes the one-shot flash
      // message, so the banner can be asserted exactly as a user sees it.
      await detail.openApprovePathDirectly(workItemId)

      await expect(browser).toHaveUrl(
        expect.stringContaining(`/work-items/${workItemId}`)
      )
      await expect(browser).not.toHaveUrl(expect.stringContaining('/approve'))

      // Belt and braces: whatever the guard renders, the one thing that
      // must never appear is the approve form itself.
      await expect($('[data-testid="approval-submit"]')).not.toBeExisting()
      await expect(
        $('[data-testid="approval-decision-note"]')
      ).not.toBeExisting()
    })

    it('explains why, rather than failing silently', async () => {
      // A bounce with no explanation reads as a broken link. The copy is
      // asserted because it is what distinguishes the tasks-incomplete
      // refusal from the pre-existing wrong-state refusal ("This work item
      // can no longer be approved from its current state"), which is a
      // different bug if it shows up here.
      const banner = $('[data-testid="work-item-flash-banner"]')

      await expect(banner).toBeDisplayed()
      await expect(banner).toHaveText(
        expect.stringContaining(
          'Complete every task for this application before approving the determination.'
        )
      )
    })

    it('refuses a direct POST to the approve route', async () => {
      // Same guard on the POST side, so a stale or crafted form cannot
      // apply the transition. `postFromPage` follows the 302, so the proof
      // of refusal is that the request ended up back on the detail page
      // rather than on the approve route.
      await workItems.openWorkItem(workItemId)

      const { redirected, url } = await detail.postFromPage(
        detail.approvePath(workItemId)
      )

      expect(redirected).toBe(true)
      expect(url).toEqual(expect.stringContaining(`/work-items/${workItemId}`))
      expect(url).not.toEqual(expect.stringContaining('/approve'))
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
      // Backend ID format (fixed 16 chars): A{YY}{Agency:1}{OperatorType:1}
      // {OrgId:6}{PostcodeSuffix:3}{Material:2}. createReAccreditation always
      // uses "plastic", so the trailing segment must be PL.
      expect(await detail.getAccreditationId()).toMatch(
        /^A\d{2}[ESNW][RX][A-Z0-9]{6}[A-Z0-9]{3}PL$/
      )
    })
  })
})
