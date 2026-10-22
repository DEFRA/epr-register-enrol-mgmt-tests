import { expect } from '@wdio/globals'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import decision from '../page-objects/decision.page.js'
import confirmContact from '../page-objects/confirm-contact.page.js'
import { utcDateParts } from './uk-time.js'

/**
 * Shared re-accreditation journey steps.
 *
 * THE CANONICAL LIFECYCLE FOR THE WHOLE SUITE. Most specs need a work item
 * parked in some particular state before they can assert anything
 * interesting, and getting a step wrong there fails the spec for a reason
 * with no connection to the behaviour under test — so the run-up lives here
 * once rather than being copied per spec.
 *
 * RA-410 removed Tasks entirely. The journey is now three green
 * call-to-action buttons and nothing else:
 *
 *   submitted              --[ "Duly make" + payment ref/date ]--> duly-made
 *   duly-made  --[ "Assign to yourself and start" ]--> assessment-in-progress
 *   assessment-in-progress --[ "Log decision" + Approved/Refused ]--> approved
 *                                                                  / rejected
 *
 * RA-527 splits each outcome into two steps:
 *
 *   assessment-in-progress --[ "Make determination" + Approved ]-->
 *     approved-pending-contact ("Approved")
 *       --[ "Confirm applicant contact" ]--> approved ("Granted")
 *
 *   assessment-in-progress --[ "Make determination" + Refused ]-->
 *     rejected-pending-contact ("Refusing")
 *       --[ "Confirm applicant contact" ]--> rejected ("Refused")
 *
 * WHAT WENT, AND WHY THE CONSTANTS ARE DELETED RATHER THAN EMPTIED:
 * `DULY_MADE_TASKS`, `ASSESSMENT_TASKS` and `DECISION_TASK` are gone, as is
 * `completeTasks`. Emptying them would let `completeTasks(ASSESSMENT_TASKS)`
 * keep compiling and silently do nothing, stranding items and failing specs
 * several steps later for a reason with no connection to the cause. A
 * deleted export fails at import, immediately and legibly.
 *
 * `driveToAwaitingDecision` is deleted for a different reason: the state
 * still exists in management-be's machine but is an INTERNAL HOP applied
 * server-side inside the single decision call. No affordance parks an item
 * there, so a helper offering to do so would model a journey no caseworker
 * can take. Specs that used it want `driveToAssessmentInProgress` (the
 * pre-decision state) or `driveToApproved` / `driveToRefused` (the outcome).
 *
 * All transitions are now UNGATED in management-be — `payment-received` no
 * longer fails with `IncompleteTasks` — so there is nothing to complete
 * before a step, only the step itself.
 */

/**
 * Create a re-accreditation work item and return
 * `{ id, organisationName }` — the name is `namePrefix` plus the suffix
 * `createWorkItem` appends (see `unique-name.js`).
 *
 * `material` is fixed to `plastic` below. The site postcode is left to
 * `createWorkItem`'s collision-safe default (see `unique-postcode.js`).
 *
 * `chargeAmountPence` (RA-316) is optional and passed straight through.
 *
 * OMITTING IT LEAVES THE ITEM WITH NO CHARGE AT ALL — there is no prefill
 * and nothing defaults it, so the duly-making page renders "Not provided".
 * That is correct for the many callers that never open that page, and it
 * means a spec which asserts a charge but forgets to supply one FAILS
 * rather than passing on a borrowed default.
 *
 * Supply it when the spec asserts on the rendered charge, and VARY IT
 * between specs: the duly-making page divides by 100 to display, and a
 * factor-of-100 slip is only conspicuous when different items show
 * different figures. Keep any value at or above 50000 pence — below that,
 * an undivided render still lands under the £50,000 ceiling in
 * `ra-316-duly-making.e2e.js` and the check silently loses its power.
 */
export async function createReAccreditation(
  namePrefix,
  { chargeAmountPence } = {}
) {
  await workItems.goto()
  const { id, organisationName } = await workItems.createWorkItem({
    organisationNamePrefix: namePrefix,
    siteAddressLine1: '1 Decision Street',
    siteAddressTown: 'London',
    material: 'plastic',
    tonnageBand: '0-500',
    chargeAmountPence
  })
  return { id, organisationName }
}

/**
 * Step 1. Submitted -> Duly made, via the RA-316 CTA and payment-date page.
 *
 * The payment date defaults to TODAY, which is valid — the rule is "today
 * or in the past". Callers wanting a back-dated SLA clock pass `dayOffset`
 * (negative days); the floor is 12 months before today.
 *
 * NOTE FOR SLA ASSERTIONS: the 12-week clock runs from the ENTERED payment
 * date at midnight UTC, not from the moment of completion. An SLA
 * expectation computed from the test clock will be wrong by however far the
 * payment date is back-dated.
 */
export async function dulyMake(workItemId, { dayOffset = 0 } = {}) {
  await workItems.openWorkItem(workItemId)
  // The precondition is asserted as "the CTA is here", not as a state name,
  // because duly making has TWO entry points: `submitted`, and `updated`
  // where the application was queried during duly-making and then
  // resubmitted. Pinning a display name would make this helper unusable from
  // the second one — and "Updated" is ambiguous anyway, since
  // `assessment-in-progress` shares it.
  expect(await detail.hasDulyMakeCta()).toBe(true)
  await detail.clickDulyMake()
  await dulyMaking.assertOnPage()
  await dulyMaking.setPaymentDate(utcDateParts(new Date(), dayOffset))
  await dulyMaking.submit()
  await dulyMaking.waitForDetailUrl(workItemId)
  await detail.assertState('Duly made')
}

/**
 * Step 2. Duly made -> Assessment in progress, via "Assign to yourself and
 * start".
 *
 * REQUIRES THE ITEM TO BE HELD BY SOMEONE ELSE OR NOBODY — management-fe only
 * renders the self-assign button when the caller does not hold the case.
 *
 * RA-595 ("switch" step). The transition the button applies is now
 * `start-assessment` ("Assessment started"), not `payment-received`. The
 * old `startAssessmentViaAction` helper, which clicked a
 * `payment-received` action button, is gone: management-fe no longer
 * renders that button, and the self-assign flow is the one shared way in.
 *
 * Asserts the RAW state id rather than the display name, because RA-324
 * gives `assessment-in-progress` and `updated` the same display name
 * ("Updated"): `assertState('Updated')` cannot tell them apart and would
 * pass against the wrong one.
 */
export async function startAssessment(workItemId) {
  await workItems.openWorkItem(workItemId)
  expect(await detail.hasAssignmentControl('selfAssign')).toBe(true)
  await detail.selfAssignAndStart()
  await detail.assertStateId('assessment-in-progress')
}

/**
 * Step 3. Assessment in progress -> Approved (step 1) / Refused, via "Make
 * determination".
 *
 * `outcome` is `'approved'` or `'refused'` — the words on the RADIOS, which
 * is what a spec author is reading off the screen. "REFUSED" IS A LABEL
 * CHANGE ONLY: the state underneath is still `rejected`, which is why the
 * state-id assertion below maps the two. Do not "fix" that mapping to match.
 *
 * RA-527: an approval is now STEP 1 OF TWO. It lands in
 * `approved-pending-contact` (tagged "Approved"), with the number minted but
 * nothing applied — the operator still sees their old status. Granted needs
 * step 2, `confirmApplicantContact` below. A refusal is the same: it lands
 * in `rejected-pending-contact` (tagged "Refusing"), and Refused needs step 2.
 *
 * One click covers both internal hops. management-be applies
 * `assessment-in-progress -> awaiting-decision -> <outcome state>` inside
 * the single call, so there is no intermediate page and nothing to assert
 * between them.
 */
export async function logDecision(workItemId, outcome, { note } = {}) {
  const outcomeStateId = {
    approved: 'approved-pending-contact',
    refused: 'rejected-pending-contact'
  }[outcome]
  if (!outcomeStateId) {
    throw new Error(
      `Unknown decision outcome "${outcome}" (expected "approved" or "refused")`
    )
  }
  await workItems.openWorkItem(workItemId)
  expect(await detail.hasLogDecisionCta()).toBe(true)
  await detail.clickLogDecision()
  await decision.assertOnPage()
  await decision.selectOutcome(outcome)
  // The note is OPTIONAL and most callers omit it — they only want the item
  // parked in a decided state. RA-203 is the spec that cares, and it passes
  // one so the Decision email's `decision_notes` personalisation has something
  // to carry. See the ordering note on `decision.page.js`: management-fe posts
  // the note before the decision precisely so the notification hook reads it.
  if (note !== undefined) {
    await decision.setNote(note)
  }
  await decision.submit()
  await decision.waitForDetailUrl(workItemId)
  await detail.assertStateId(outcomeStateId)
}

/**
 * Submitted -> Duly made -> Assessment in progress.
 *
 * Leaves the browser on the detail page with the "Log decision" CTA
 * available and the case assigned to the logged-in user.
 */
export async function driveToAssessmentInProgress(workItemId) {
  await dulyMake(workItemId)
  await startAssessment(workItemId)
}

/**
 * RA-527. The whole journey through step 1 of an approval:
 * `approved-pending-contact` ("Approved" on screen). The accreditation
 * number is minted and shown to the regulator, the persistent "Application
 * approved" banner and the "Confirm applicant contact" button are on the
 * page, and the operator's status is unchanged.
 *
 * Leaves the browser on the detail page.
 */
export async function driveToApprovedPendingContact(workItemId) {
  await driveToAssessmentInProgress(workItemId)
  await logDecision(workItemId, 'approved')
  await detail.assertState('Approved')
  expect(await detail.hasPendingContactBanner()).toBe(true)
  expect(await detail.hasConfirmApplicantContactCta()).toBe(true)
}

/**
 * RA-527. The whole journey through step 1 of a refusal:
 * `rejected-pending-contact` ("Refusing" on screen). No number is minted,
 * the persistent "Application refused" banner and the "Confirm applicant
 * contact" button are on the page, and the operator's status is unchanged.
 *
 * Leaves the browser on the detail page.
 */
export async function driveToRefusingPendingContact(workItemId) {
  await driveToAssessmentInProgress(workItemId)
  await logDecision(workItemId, 'refused')
  await detail.assertState('Refusing')
  expect(await detail.hasPendingContactBanner()).toBe(true)
  expect(await detail.hasConfirmApplicantContactCta()).toBe(true)
}

// RA-527. Where step 2 lands from each step 1 state.
const CONFIRMED_STATE_IDS = {
  'approved-pending-contact': 'approved',
  'rejected-pending-contact': 'rejected'
}

/**
 * RA-527. Step 2, for either outcome: Approved (pending contact) -> Granted,
 * or Refusing -> Refused, via "Confirm applicant contact", ticking "I have
 * contacted the applicant about the decision" and "Confirm and continue".
 *
 * THIS is the moment the outcome is applied: the operator journey is told
 * (its status becomes Approved / Rejected, shown to the operator as GRANTED
 * / REFUSED) and the SLA clock stops. For an approval publishing is queued
 * and the Decision email is sent; a refusal sends no email. The detail page
 * then shows the one-time "Applicant contacted" flash.
 *
 * The redirect wait is long because management-be pushes to the operator
 * journey BEFORE it writes, retrying for up to ~28s when that is slow.
 *
 * Leaves the browser on the detail page.
 */
export async function confirmApplicantContact(workItemId) {
  await workItems.openWorkItem(workItemId)
  const pendingStateId = await detail.stateId()
  const confirmedStateId = CONFIRMED_STATE_IDS[pendingStateId]
  if (!confirmedStateId) {
    throw new Error(
      `Work item ${workItemId} is not pending applicant contact (state "${pendingStateId}")`
    )
  }
  expect(await detail.hasConfirmApplicantContactCta()).toBe(true)
  await detail.clickConfirmApplicantContact()
  await confirmContact.assertOnPage()
  await confirmContact.tickContacted()
  await confirmContact.submit()
  await confirmContact.waitForDetailUrl(workItemId)
  await detail.assertStateId(confirmedStateId)
}

/**
 * The whole journey through to `approved` ("Granted" on screen): step 1
 * (`driveToApprovedPendingContact`) then step 2 (`confirmApplicantContact`).
 */
export async function driveToApproved(workItemId) {
  await driveToApprovedPendingContact(workItemId)
  await confirmApplicantContact(workItemId)
}

/**
 * The whole journey through to `rejected` ("Refused" on screen): step 1
 * (`driveToRefusingPendingContact`) then step 2 (`confirmApplicantContact`).
 */
export async function driveToRefused(workItemId) {
  await driveToRefusingPendingContact(workItemId)
  await confirmApplicantContact(workItemId)
}
