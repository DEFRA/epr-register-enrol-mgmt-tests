import { expect } from '@wdio/globals'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import { ukDateParts } from './uk-time.js'

/**
 * Shared re-accreditation journey steps (RA-346).
 *
 * Driving a freshly created work item down to `awaiting-decision` takes
 * three states' worth of task completion and two transitions. Both RA-346
 * specs need the same run-up before they can assert anything interesting,
 * and getting a step wrong there would fail the spec for a reason that has
 * nothing to do with the behaviour under test — so the run-up lives here
 * once rather than being copied per spec.
 *
 * The task ids mirror `TASKS_BY_STATE` in management-fe's re-accreditation
 * module (and `ReAccreditationType` in management-be, which is the shared
 * contract). Exported so the specs name the gate they are testing rather
 * than repeating string literals.
 */

/**
 * RA-316 deleted the `submitted`-state tasks
 * (`verify-organisation-details`, `confirm-application-completeness`) and
 * the hook that auto-transitioned to `duly-made` when the last of them was
 * ticked. `submitted` now has an EMPTY task list and the only route into
 * `duly-made` is the "Duly make" CTA plus a payment date.
 *
 * The constant is deliberately gone rather than emptied: an empty array
 * would let `completeTasks(SUBMITTED_TASKS)` keep compiling and silently do
 * nothing, leaving items stranded in `submitted` and failing specs several
 * steps later for a reason with no connection to the cause.
 *
 * Tasks still exist for the OTHER states — their removal is RA-410 — so the
 * task machinery below stays.
 */

export const DULY_MADE_TASKS = ['confirm-registration-fee-paid']

/**
 * The `assessment-in-progress` tasks that gate `submit-for-decision`
 * (RA-346 issue 1).
 */
export const ASSESSMENT_TASKS = [
  'review-compliance-history',
  'assess-technical-capacity',
  'assess-financial-capacity'
]

/**
 * The single `awaiting-decision` task that gates `approve` (RA-346 issue
 * 2 — the actual bug: approve ran outside the all-tasks-complete gate).
 */
export const DECISION_TASK = 'record-decision-rationale'

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
 * This is not hypothetical headroom. As of RA-346 the tuple
 * `(EA, '1AA', 'PL')` already has exactly 5 members (ra-235, ra-238,
 * ra-295-assignment-and-query, ra-295-case-header,
 * re-accreditation-operator-email-contract), so it is AT the ceiling: a
 * clean run consumes all 5 slots and every one of those specs fails on any
 * subsequent run against the same database. See epr-p5rt for the fixture
 * hygiene and epr-s9uc for the generator defect underneath it.
 *
 * The organisation name is still timestamped so a human reading the
 * work-items list can tell runs apart.
 */
/**
 * `chargeAmountPence` (RA-316) is optional and passed straight through.
 *
 * OMITTING IT LEAVES THE ITEM WITH NO CHARGE AT ALL — there is no prefill
 * and nothing defaults it, so the duly-making page renders "Not provided".
 * That is correct for the many callers that never open that page, and it
 * means a spec which asserts a charge but forgets to supply one FAILS
 * rather than passing on a borrowed default.
 *
 * Supply it when the spec asserts on the rendered charge, and VARY IT
 * between specs: the duly-making page divides
 * by 100 to display, and a factor-of-100 slip is only conspicuous when
 * different items show different figures. If every item rendered the same
 * amount, a hardcoded value somewhere downstream could match it by accident
 * and hide the very bug the magnitude assertion exists to catch.
 *
 * Keep any value at or above 50000 pence. Below that, an undivided render
 * still lands under the £50,000 ceiling in
 * `ra-316-duly-making.e2e.js` and the check silently loses its power —
 * management-be enforces the same floor on its seeds for this reason.
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

async function completeTasks(taskIds) {
  await detail.gotoTasks()
  for (const taskId of taskIds) {
    await detail.setTaskStatus(taskId, 'Completed')
  }
  await detail.gotoDetail()
}

/**
 * Submitted -> Duly made, via the RA-316 CTA and payment-date page.
 *
 * THE CANONICAL duly-making step for the whole suite. Every journey that
 * needs an item past `submitted` should call this rather than re-deriving
 * the flow, so when the page moves again there is one place to change.
 *
 * The payment date defaults to TODAY, which is valid — the rule is "today
 * or in the past". Callers wanting a back-dated SLA clock pass `dayOffset`
 * (negative days); the floor is 12 months before today.
 *
 * NOTE FOR SLA ASSERTIONS: the 12-week clock now runs from the ENTERED
 * payment date at midnight UTC, not from the moment of completion. An SLA
 * expectation computed from the test clock will be wrong by however far the
 * payment date is back-dated.
 */
export async function dulyMake(workItemId, { dayOffset = 0 } = {}) {
  await workItems.openWorkItem(workItemId)
  // The precondition is asserted as "the CTA is here", not as a state name,
  // because duly making has TWO entry points: `submitted`, and `updated`
  // where the projected tasks came from `submitted` (an application queried
  // during duly-making and then resubmitted). Pinning a display name would
  // make this helper unusable from the second one — and "Updated" is
  // ambiguous anyway, since `assessment-in-progress` shares it.
  expect(await detail.hasDulyMakeCta()).toBe(true)
  await detail.clickDulyMake()
  await dulyMaking.assertOnPage()
  await dulyMaking.setPaymentDate(ukDateParts(new Date(), dayOffset))
  await dulyMaking.submit()
  await dulyMaking.waitForDetailUrl(workItemId)
  await detail.assertState('Duly made')
}

/**
 * Submitted -> Duly made -> Assessment in progress.
 *
 * `duly-made -> assessment-in-progress` still needs the explicit
 * `payment-received` action; RA-316 kept that transition untouched and only
 * changed the route INTO `duly-made`.
 *
 * Leaves the browser on the detail page with every
 * `assessment-in-progress` task still incomplete — which is exactly the
 * state RA-346 issue 1 is about.
 */
export async function driveToAssessmentInProgress(workItemId) {
  await dulyMake(workItemId)

  await completeTasks(DULY_MADE_TASKS)
  await detail.triggerAction('payment-received')
  // `assessment-in-progress` deliberately displays as "Updated" (RA-324).
  await detail.assertState('Updated')
}

/**
 * Assessment in progress -> Awaiting decision, completing every
 * assessment task first because `submit-for-decision` is gated on them.
 *
 * Leaves the browser on the detail page with `record-decision-rationale`
 * still incomplete — the state RA-346 issue 2 is about.
 */
export async function driveToAwaitingDecision(workItemId) {
  await driveToAssessmentInProgress(workItemId)
  await completeTasks(ASSESSMENT_TASKS)
  await detail.triggerAction('submit-for-decision')
  await detail.assertState('Awaiting decision')
}

export async function completeDecisionTask() {
  await completeTasks([DECISION_TASK])
}
