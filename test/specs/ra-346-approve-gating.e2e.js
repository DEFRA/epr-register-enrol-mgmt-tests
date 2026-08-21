import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import decision from '../page-objects/decision.page.js'
import {
  createReAccreditation,
  driveToAssessmentInProgress,
  logDecision
} from '../support/re-accreditation-journey.js'

/**
 * RA-346 (issue 2), re-pointed by RA-410 — a determination can be logged
 * exactly once, and never from a closed case.
 *
 * WHAT THIS SPEC USED TO ASSERT: that `approve` and `reject` were withheld
 * until the `record-decision-rationale` task was complete, that a direct
 * GET to the approve interstitial bounced with an explanatory flash banner,
 * and that a direct POST was refused.
 *
 * WHY IT CHANGED: RA-410 deleted the task that gate hung on. The original bug
 * — "approve ran outside the gate" — was really about a determination being
 * applied when the case was not in a fit state to produce one, and THAT
 * concern outlives the mechanism. The terminal-state guard is now the thing
 * standing between a caseworker and a second, contradictory determination on
 * the same application, so this file re-points there.
 *
 * WHAT IT ASSERTS NOW:
 *   1. A logged decision is terminal: the CTA is withdrawn afterwards.
 *   2. The Log decision route refuses a second attempt, so a stale tab or a
 *      crafted request cannot overwrite a determination that already issued.
 *   3. The first decision's outcome survives the refused second attempt —
 *      an approved application is not quietly flipped to Refused.
 *
 * Point 3 is the one that matters most: a guard that returned an error but
 * had already applied the transition would still be the bug in the original
 * ticket, merely relocated.
 */
describe('RA-346/RA-410 A determination can be logged only once', () => {
  let workItemId

  before(async () => {
    await login.login()
    // Distinct from the RA-346 submit-for-decision spec's postcode on
    // purpose — see `createReAccreditation`. `SW1A 1AE` is unused elsewhere.
    workItemId = await createReAccreditation(
      'Approve Decision Gate',
      'SW1A 1AE'
    )
    await driveToAssessmentInProgress(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  describe('before any decision is logged', () => {
    it('offers the Log decision CTA and no approval panel', async () => {
      // The positive half. Every absence assertion below is only meaningful
      // if the affordance was genuinely there to begin with.
      expect(await detail.hasLogDecisionCta()).toBe(true)
      await expect(
        $('[data-testid="re-accreditation-approval-panel"]')
      ).not.toBeExisting()
    })

    it('offers both outcomes on the Log decision page', async () => {
      await detail.clickLogDecision()
      await decision.assertOnPage()

      expect(await decision.hasOutcomeRadio('approved')).toBe(true)
      expect(await decision.hasOutcomeRadio('refused')).toBe(true)

      // RA-410 renames the outcome a regulator reads. The state underneath is
      // still `rejected`, so this is the only place the rename is observable
      // — asserting it on the state id would be asserting the opposite.
      expect(await decision.outcomeLabelText('refused')).toContain('Refused')
      expect(await decision.outcomeLabelText('refused')).not.toContain(
        'Rejected'
      )
    })
  })

  describe('once the determination is approved', () => {
    before(async () => {
      await logDecision(workItemId, 'approved')
    })

    it('issues the accreditation', async () => {
      // The guard must not have been implemented by breaking approve: the
      // RA-133 journey has to still complete, panel and all.
      await detail.assertState('Granted')
      await detail.assertApprovalPanelVisible()
      // Real backend ID shape: A{YY}{Agency:1}{OperatorType:1}{OrgId:6}
      // {Sequence:3}{Material:2}. RA-448 phase 2 moved generation to a real
      // (here, stubbed) backend call that never receives the application's
      // material, so the trailing segment can't be asserted as a specific
      // code — see docker/stubs/operator-backend-stub.mjs.
      expect(await detail.getAccreditationId()).toMatch(
        /^A\d{2}[ESNW][RX][A-Z0-9]{6}[A-Z0-9]{3}[A-Z]{2}$/
      )
    })

    it('withdraws the Log decision CTA', async () => {
      expect(await detail.hasLogDecisionCta()).toBe(false)
    })

    it('replaces the action panel with the read-only outcome', async () => {
      await detail.assertReadOnlyOutcomePanel('Granted')
      await detail.assertNoDecisionActions()
    })

    it('refuses a direct GET back to the Log decision route', async () => {
      // The route is guessable, and a caseworker with the page still open in
      // another tab is the realistic version of this request.
      await decision.gotoFor(workItemId)

      await expect(browser).not.toHaveUrl(expect.stringContaining('/decision'))
      expect(await decision.hasOutcomeRadio('refused')).toBe(false)
    })

    it('refuses a direct POST attempting to overwrite the outcome', async () => {
      await workItems.openWorkItem(workItemId)

      const { status, url } = await detail.postFromPage(
        decision.path(workItemId)
      )

      // Refusal takes one of two correct shapes depending on whether
      // management-fe surfaces management-be's 409 or follows this app's PRG
      // convention and redirects. Both are refusals; what must NOT happen is a
      // success that leaves the browser on a second decision confirmation.
      const refused = status >= 400 || !url.includes('/decision')
      expect(refused).toBe(true)
    })

    it('keeps the original outcome after the refused attempts', async () => {
      // The assertion the whole file exists for. A guard that errored AFTER
      // applying the transition would satisfy every check above and still be
      // the original bug.
      await workItems.openWorkItem(workItemId)

      await detail.assertStateId('approved')
      await detail.assertState('Granted')
      await detail.assertApprovalPanelVisible()
    })
  })
})
