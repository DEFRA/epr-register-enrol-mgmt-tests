import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import withdrawPage from '../page-objects/withdraw.page.js'

/**
 * Journeys that drive a re-accreditation work item into each of the three
 * terminal states (RA-358 assignment gating).
 *
 * These live here rather than in a page object because they are not knowledge
 * about a screen — they are multi-page journeys that cross the tasks list, the
 * detail page and the withdraw interstitial. `support/` already holds this
 * kind of cross-cutting helper (see uk-time.js).
 *
 * NOTE: ra-313-withdrawn-in-worklist.e2e.js (formerly ra-224-archived-items)
 * contains a near-identical `driveToAwaitingDecision`. It is deliberately NOT
 * refactored to use this module here: that spec is passing and unrelated to
 * RA-358, and rewriting its setup to prove a point about duplication would
 * risk a green spec for no behavioural gain. Deduplicating the two is filed
 * as follow-up work.
 */

/**
 * Create a work item and drive it to `Awaiting decision`, the state from which
 * both `approve` and `reject` are available.
 *
 * Assumes the caller is already logged in and on the work-items list.
 */
export async function driveToAwaitingDecision({ organisationName, material }) {
  const { id } = await workItems.createWorkItem({
    organisationName,
    siteAddressLine1: '1 Terminal Way',
    siteAddressTown: 'York',
    siteAddressPostcode: 'YO1 2AF',
    material,
    tonnageBand: '0-500'
  })

  await workItems.openWorkItem(id)
  await detail.assertState('Not started')

  // Submitted -> Duly made (auto-transition on the last submitted task).
  await detail.gotoTasks()
  await detail.setTaskStatus('verify-organisation-details', 'Completed')
  await detail.setTaskStatus('confirm-application-completeness', 'Completed')
  await detail.gotoDetail()
  await detail.assertState('Duly made')

  // Duly made -> Assessment in progress.
  await detail.gotoTasks()
  await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
  await detail.gotoDetail()
  await detail.triggerAction('payment-received')
  await detail.assertState('Updated')

  // Assessment in progress -> Awaiting decision.
  await detail.gotoTasks()
  await detail.setTaskStatus('review-compliance-history', 'Completed')
  await detail.setTaskStatus('assess-technical-capacity', 'Completed')
  await detail.setTaskStatus('assess-financial-capacity', 'Completed')
  await detail.gotoDetail()
  await detail.triggerAction('submit-for-decision')
  await detail.assertState('Awaiting decision')

  return id
}

/**
 * Create a work item and withdraw it straight from `submitted` — the shortest
 * route to a terminal state, one interstitial rather than the whole approval
 * journey.
 */
export async function createWithdrawnWorkItem({ organisationName, material }) {
  const { id, applicationReference } = await workItems.createWorkItem({
    organisationName,
    siteAddressLine1: '1 Terminal Way',
    siteAddressTown: 'York',
    siteAddressPostcode: 'YO1 2AF',
    material,
    tonnageBand: '0-500'
  })

  await workItems.openWorkItem(id)
  await detail.triggerAction('withdraw')
  await withdrawPage.submit()
  await withdrawPage.waitForDetailUrl(id)
  await detail.assertState('Withdrawn')

  return { id, applicationReference }
}

/**
 * Complete the decision-rationale task, which RA-346 made a precondition of
 * both decision actions — without it `approve` and `reject` are not projected
 * onto the detail page at all.
 */
async function completeDecisionRationale(id) {
  await workItems.openWorkItem(id)
  await detail.assertState('Awaiting decision')
  await detail.gotoTasks()
  await detail.setTaskStatus('record-decision-rationale', 'Completed')
  await detail.gotoDetail()
}

/**
 * Drive an `Awaiting decision` item to `Granted`.
 *
 * `approve` is a two-step action: the action opens the approval panel and the
 * transition only happens on submit, unlike `reject` which applies directly.
 */
export async function approveWorkItem(id) {
  await completeDecisionRationale(id)
  await detail.triggerAction('approve')
  await detail.submitApproval()
  await detail.assertState('Granted')
  return id
}

/** Drive an `Awaiting decision` item to `Refused`. */
export async function rejectWorkItem(id) {
  await completeDecisionRationale(id)
  await detail.triggerAction('reject')
  await detail.assertState('Refused')
  return id
}
