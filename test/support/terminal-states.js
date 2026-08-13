import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import withdrawPage from '../page-objects/withdraw.page.js'
import {
  dulyMake,
  logDecision,
  startAssessment
} from './re-accreditation-journey.js'

/**
 * Journeys that drive a re-accreditation work item into each of the three
 * terminal states (RA-358 assignment gating).
 *
 * These live here rather than in a page object because they are not knowledge
 * about a screen — they are multi-page journeys across the detail page, the
 * duly-making page, the Log decision page and the withdraw interstitial.
 * `support/` already holds this kind of cross-cutting helper (see uk-time.js).
 *
 * RA-410 rebuilt every step onto the green CTA flow; the task-completion
 * run-up these functions used to carry is gone along with the feature.
 *
 * NOTE: ra-313-withdrawn-in-worklist.e2e.js contains a near-identical
 * pre-decision drive. Deduplicating the two is filed as follow-up work.
 */

/**
 * Create a work item and drive it to `assessment-in-progress` — the state
 * from which a decision can be logged.
 *
 * REPLACES `driveToAwaitingDecision`. `awaiting-decision` still exists in
 * management-be's state machine, but RA-410 made it an internal hop applied
 * server-side inside the single decision call: no affordance parks an item
 * there, so a helper offering to do so would model a journey no caseworker
 * can take.
 *
 * Assumes the caller is already logged in.
 */
export async function driveToDecisionReady({ organisationName, material }) {
  const { id } = await workItems.createWorkItem({
    organisationName,
    siteAddressLine1: '1 Terminal Way',
    siteAddressTown: 'York',
    siteAddressPostcode: 'YO1 2AF',
    material,
    tonnageBand: '0-500'
  })

  // Submitted -> Duly made, via the "Duly make" CTA and a payment date.
  await dulyMake(id)
  // Duly made -> Assessment in progress, via "Assign to yourself and start".
  await startAssessment(id)

  return id
}

/**
 * Create a work item and withdraw it straight from `submitted` — the shortest
 * route to a terminal state, one interstitial rather than the whole journey.
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
 * Drive an `assessment-in-progress` item to `Granted`, via "Log decision" ->
 * Approved.
 */
export async function approveWorkItem(id) {
  await logDecision(id, 'approved')
  await detail.assertState('Granted')
  return id
}

/**
 * Drive an `assessment-in-progress` item to `Refused`, via "Log decision" ->
 * Refused.
 *
 * The visible status reads "Refused" and the underlying state id is still
 * `rejected` — RA-410 renamed the label only. `logDecision` asserts the id;
 * this asserts what the regulator actually sees.
 */
export async function rejectWorkItem(id) {
  await logDecision(id, 'refused')
  await detail.assertState('Refused')
  return id
}
