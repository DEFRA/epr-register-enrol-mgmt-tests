import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  dulyMake,
  logDecision,
  startAssessment
} from '../support/re-accreditation-journey.js'

/**
 * RA-132 — Rejecting a re-accreditation drives it to the Refused terminal
 * state and replaces the generic action panel with a read-only outcome.
 *
 * Approve is covered end-to-end (re-accreditation-approval.e2e.js); this is
 * the parallel Refused outcome. Both now go through the same Log decision
 * page and differ only in which radio is chosen, which is exactly why they
 * are worth asserting separately — a wiring slip that sent both outcomes to
 * the same terminal state would satisfy either spec alone.
 *
 * RA-410 rebuilt the journey onto the three green CTAs and removed Tasks:
 *   1. A caseworker creates a re-accreditation work item (Not started).
 *   2. "Duly make" + payment ref/date          -> Duly made.
 *   3. "Assign to yourself and start"          -> Assessment in progress.
 *   4. "Log decision" + the Refused radio      -> Refused.
 *   5. The detail page surfaces the read-only "Outcome" panel + a red
 *      "Refused" state tag, and the generic decision actions disappear.
 *
 * The archive-from-worklist behaviour of the reject path is covered
 * separately by RA-224 (ra-224-archived-items.e2e.js); this spec asserts
 * the terminal detail-page outcome instead of duplicating that.
 */
describe('RA-132 Reject action terminal flow', () => {
  let workItemId

  it('creates a re-accreditation and drives it to assessment-in-progress', async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'Reject Outcome Test Ltd',
        siteAddressLine1: '3 Rejection Row',
        siteAddressTown: 'Bristol',
        siteAddressPostcode: 'BS1 1AA',
        material: 'paper',
        tonnageBand: '0-500'
      })
    ).id

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Not started')

    // Submitted -> Duly made. RA-316 replaced the submitted tasks and
    // the auto-transition hook with the "Duly make" CTA and a payment
    // date; the shared helper owns that journey.
    await dulyMake(workItemId)

    // Duly made -> Assessment in progress
    await startAssessment(workItemId)
    await detail.assertStateId('assessment-in-progress')

    await login.logout()
  })

  it('refuses the work item as the decision maker and surfaces the read-only outcome', async () => {
    await login.login()

    // RA-410: the determination is logged through the "Log decision" CTA and
    // an Approved/Refused radio. `reject` is no longer a caller-invocable
    // action — management-be does not list it in `availableActions` at all —
    // so the old `triggerAction('reject')` route cannot reach this state.
    //
    // "Refused" is the LABEL only: the state id underneath is still
    // `rejected`, which is what `logDecision` asserts on the way through.
    await logDecision(workItemId, 'refused')
    await detail.assertState('Refused')

    // RA-132: the terminal state replaces the generic action panel with a
    // read-only "Outcome" panel and a red "Refused" state tag.
    await detail.assertReadOnlyOutcomePanel('Refused')
    await detail.assertNoDecisionActions()

    // No approval confirmation panel is rendered for a rejected item — that
    // panel is built only for the approved state.
    await expect(
      $('[data-testid="re-accreditation-approval-panel"]')
    ).not.toBeExisting()

    await login.logout()
  })

  it('keeps the read-only outcome on return — reject is terminal and idempotent', async () => {
    await login.login()
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Refused')
    await detail.assertReadOnlyOutcomePanel('Refused')
    await detail.assertNoDecisionActions()
    await login.logout()
  })
})
