import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-132 — Rejecting a re-accreditation drives it to the Rejected terminal
 * state and replaces the generic action panel with a read-only outcome.
 *
 * Approve is covered end-to-end (re-accreditation-approval.e2e.js); this is
 * the parallel reject outcome. Unlike approve, reject has no dedicated
 * interstitial — it is a warning-style action that posts straight through
 * the generic action engine (POST /work-items/{id}/actions/reject) and
 * PRG-redirects back to the detail page in the Rejected terminal state.
 *
 * The journey to the Awaiting decision state (where reject becomes
 * available) mirrors the approval spec:
 *   1. A caseworker creates a re-accreditation work item (Submitted).
 *   2. Tasks are completed and the item progressed (auto-duly-made ->
 *      payment-received -> submit-for-decision) up to Awaiting decision.
 *   3. A caseworker completes the awaiting-decision task and rejects
 *      (RA-323 — every caseworker holds the same role).
 *   4. The detail page surfaces the read-only "Outcome" panel + a red
 *      "Rejected" state tag, and the generic decision actions disappear.
 *
 * The archive-from-worklist behaviour of the reject path is covered
 * separately by ra-313-withdrawn-in-worklist.e2e.js; this spec asserts
 * the terminal detail-page outcome instead of duplicating that.
 */
describe('RA-132 Reject action terminal flow', () => {
  let workItemId

  it('creates a re-accreditation and drives it to awaiting-decision', async () => {
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
    await detail.assertState('Submitted')

    // Submitted -> Duly made (auto-transition fires when last submitted task completes)
    await detail.gotoTasks()
    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')
    await detail.gotoDetail()
    await detail.assertState('Duly made')

    // Duly made -> Assessment in progress
    await detail.gotoTasks()
    await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('payment-received')
    await detail.assertState('Assessment in progress')

    // Assessment in progress -> Awaiting decision
    await detail.gotoTasks()
    await detail.setTaskStatus('review-compliance-history', 'Completed')
    await detail.setTaskStatus('assess-technical-capacity', 'Completed')
    await detail.setTaskStatus('assess-financial-capacity', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('submit-for-decision')
    await detail.assertState('Awaiting decision')

    await login.logout()
  })

  it('rejects the work item as the decision maker and surfaces the read-only outcome', async () => {
    await login.login()
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Awaiting decision')

    // The reject transition requires all awaiting-decision tasks complete.
    await detail.gotoTasks()
    await detail.setTaskStatus('record-decision-rationale', 'Completed')
    await detail.gotoDetail()

    // Reject is a warning-style generic action — a single click posts
    // through the engine and redirects back to the detail page.
    await detail.triggerAction('reject')
    await detail.assertState('Rejected')

    // RA-132: the terminal state replaces the generic action panel with a
    // read-only "Outcome" panel and a red "Rejected" state tag.
    await detail.assertReadOnlyOutcomePanel('Rejected')
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
    await detail.assertState('Rejected')
    await detail.assertReadOnlyOutcomePanel('Rejected')
    await detail.assertNoDecisionActions()
    await login.logout()
  })
})
