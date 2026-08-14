import { expect } from '@wdio/globals'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import decision from '../page-objects/decision.page.js'
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
 * Create a re-accreditation work item and return its id.
 *
 * `postcode` is a required argument rather than a constant. THE RULE: pick
 * one whose LAST 3 CHARACTERS are not already used by another spec creating
 * the same material. `material` is deliberately fixed to `plastic` below
 * and forms part of the key, so it is not a free variable you can vary to
 * dodge a clash — change it and you change which specs you collide with.
 *
 * Why the last 3 characters and not the whole postcode: the RA-318
 * application reference is built from (accreditation year, agency code,
 * operatorOrganisationId, LAST 3 postcode characters, FIRST 2 material
 * characters). Two details make this trap people:
 *
 *  - The organisation NAME is not in the key, so timestamping it does
 *    nothing to keep references apart (it is there for humans reading the
 *    work-items list). `operatorOrganisationId` is not in the key either in
 *    practice — the case-management create form has no such field, so it is
 *    empty for every fixture this helper makes.
 *  - The agency code comes from the postcode's LEADING letters, not its
 *    suffix (Scotland/Wales/NI sets map to SE/NR/NI, everything else EA).
 *    So `EH1 1AA` and `SW1A 1AA` genuinely do not clash. Existing specs rely
 *    on this, which is why the tree contains apparent counter-examples to
 *    the rule above. The rule is deliberately stricter than the mechanism —
 *    follow it and you are safe without having to reason about agencies.
 *
 * Why it matters: at most 5 work items can EVER share one tuple. The
 * generator disambiguates with a retry loop producing `'0' + attempt % 10`,
 * capped at 5 attempts, then fails permanently with "Failed to generate a
 * unique applicationReference after 5 attempts" — no retry clears it. The
 * failure is therefore by accumulation across runs, not a pairwise clash,
 * which is why a clean database passes and a reused one fails.
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
  postcode,
  { chargeAmountPence } = {}
) {
  await workItems.goto()
  const { id } = await workItems.createWorkItem({
    organisationName: `${namePrefix} ${Date.now()}`,
    siteAddressLine1: '1 Decision Street',
    siteAddressTown: 'London',
    siteAddressPostcode: postcode,
    material: 'plastic',
    tonnageBand: '0-500',
    chargeAmountPence
  })
  return id
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
 * REQUIRES THE ITEM TO BE UNASSIGNED — management-fe only renders the
 * self-assign button when nobody holds the case. A caller that has already
 * assigned the item to someone must unassign first, or drive the transition
 * with `startAssessmentViaAction` below.
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
 * Step 2, without taking the case.
 *
 * `payment-received` survives RA-410 as an ordinary caller-invocable action,
 * so this drives the same transition while leaving assignment alone. Use it
 * where the spec is about something else and self-assigning would change the
 * assignee out from under an assertion — the RA-335 read-only user, say, or
 * a spec that has deliberately assigned the case to another officer.
 */
export async function startAssessmentViaAction(workItemId) {
  await workItems.openWorkItem(workItemId)
  await detail.triggerAction('payment-received')
  await detail.assertStateId('assessment-in-progress')
}

/**
 * Step 3. Assessment in progress -> Approved / Refused, via "Log decision".
 *
 * `outcome` is `'approved'` or `'refused'` — the words on the RADIOS, which
 * is what a spec author is reading off the screen. "REFUSED" IS A LABEL
 * CHANGE ONLY: the state underneath is still `rejected`, which is why the
 * state-id assertion below maps the two. Do not "fix" that mapping to match.
 *
 * One click covers both hops. management-be applies
 * `assessment-in-progress -> awaiting-decision -> approved/rejected` inside
 * the single call, so there is no intermediate page and nothing to assert
 * between them.
 */
export async function logDecision(workItemId, outcome, { note } = {}) {
  const terminalStateId = { approved: 'approved', refused: 'rejected' }[outcome]
  if (!terminalStateId) {
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
  // parked in a terminal state. RA-203 is the spec that cares, and it passes
  // one so the Decision email's `decision_notes` personalisation has something
  // to carry. See the ordering note on `decision.page.js`: management-fe posts
  // the note before the decision precisely so the notification hook reads it.
  if (note !== undefined) {
    await decision.setNote(note)
  }
  await decision.submit()
  await decision.waitForDetailUrl(workItemId)
  await detail.assertStateId(terminalStateId)
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

/** The whole journey through to `approved` ("Granted" on screen). */
export async function driveToApproved(workItemId) {
  await driveToAssessmentInProgress(workItemId)
  await logDecision(workItemId, 'approved')
}

/** The whole journey through to `rejected` ("Refused" on screen). */
export async function driveToRefused(workItemId) {
  await driveToAssessmentInProgress(workItemId)
  await logDecision(workItemId, 'refused')
}
