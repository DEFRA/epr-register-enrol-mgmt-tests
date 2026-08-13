import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import decision from '../page-objects/decision.page.js'
import {
  createReAccreditation,
  driveToAssessmentInProgress
} from '../support/re-accreditation-journey.js'
import {
  armDecisionFailure,
  clearDecisionFailure
} from '../support/operator-backend-stub.js'

/**
 * RA-410 / epr-p86e — the decision is atomic and OPERATOR-JOURNEY-GATED.
 *
 * management-be no longer moves a re-accreditation to its terminal state and
 * then tells the operator-journey (OJ) backend as an afterthought. It pushes
 * the status change to OJ FIRST and only completes the transition once that
 * push is acknowledged. If the push cannot be delivered (OJ down, retries
 * exhausted) the whole decision fails: management-be returns HTTP 500 and
 * applies NO state change — the item is left exactly where it was,
 * `assessment-in-progress`, still decidable.
 *
 * management-fe surfaces that 500 as a GENERIC failure: it PRG-redirects back
 * to the detail page and flashes the `--error` variant of the work-item flash
 * banner ("Could not log a decision"). It is not a field error on the Log
 * decision form and not a full-page error template.
 *
 * WHY THIS NEEDS A STUB. The real OJ backend is not part of the journey-test
 * compose stack, so the push is answered by `operator-backend-stub`, which
 * returns 200 by default. This spec ARMS that stub to return 500 for one work
 * item's push — the only honest way to reach the failure branch here — then
 * proves the two things that matter:
 *
 *   1. the caseworker is told, generically, that it did not work; and
 *   2. the item did NOT slip into a terminal state, nor strand in the internal
 *      `awaiting-decision` waypoint — it is still `assessment-in-progress` and
 *      the "Log decision" CTA is still on offer.
 *
 * The last `it` clears the arm and decides the SAME item successfully. That is
 * load-bearing: it proves the failure was the OJ push and not a broken submit,
 * and that the failed attempt left no partial state behind that would block a
 * genuine retry.
 */
describe('RA-410 The OJ-gated decision fails atomically', () => {
  let workItemId

  before(async () => {
    await login.login()
    // `SW1A 1AO` is unused elsewhere — see `createReAccreditation`.
    workItemId = await createReAccreditation('CTA OJ Failure', 'SW1A 1AO')
    await driveToAssessmentInProgress(workItemId)
  })

  after(async () => {
    // Belt-and-braces: ids are unique per item so a leaked arm is harmless,
    // but leave the stub clean for whatever runs next in the same stack.
    await clearDecisionFailure(workItemId)
    await login.logout()
  })

  it('shows a generic error and holds the item in assessment when OJ is down', async () => {
    await armDecisionFailure(workItemId)

    await detail.clickLogDecision()
    await decision.assertOnPage()
    await decision.selectOutcome('approved')
    await decision.submit()

    // fe PRG-redirects back to the detail page on the 500 — not a full error
    // page, not a stay-on-form field error. The push is a PRE-COMMIT GATE that
    // retries (~28s worst case per management-be) before the request returns
    // 500, so the redirect can be well over the default 10s wait — hence the
    // longer timeout here, still comfortably inside Mocha's 60s per-test limit.
    await decision.waitForDetailUrl(workItemId, { timeout: 45000 })
    await detail.assertErrorFlashBanner()

    // The whole point of "atomic": the state did not move. Not `approved`,
    // not the internal `awaiting-decision` waypoint — still assessment.
    await detail.assertStateId('assessment-in-progress')
    // ...and there is no approval panel / accreditation id, because nothing
    // was granted.
    await expect(detail.approveCta()).not.toBeExisting()
  })

  it('leaves the item decidable — the Log decision CTA is still offered', async () => {
    // A failed decision that had nonetheless suppressed the CTA (or shown the
    // read-only outcome panel) would strand the caseworker with no way
    // forward. The detail page must still offer the next step.
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('assessment-in-progress')
    expect(await detail.hasLogDecisionCta()).toBe(true)
  })

  it('decides successfully once OJ is reachable again', async () => {
    await clearDecisionFailure(workItemId)

    await detail.clickLogDecision()
    await decision.assertOnPage()
    await decision.selectOutcome('approved')
    await decision.submit()
    await decision.waitForDetailUrl(workItemId)

    // The failed attempt left nothing behind: the same item now reaches the
    // terminal state cleanly through its declared edge.
    await detail.assertStateId('approved')
    await detail.assertState('Granted')
    await detail.assertApprovalPanelVisible()
  })
})
