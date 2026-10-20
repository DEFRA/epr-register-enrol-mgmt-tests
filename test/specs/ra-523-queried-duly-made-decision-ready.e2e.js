import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import {
  createReAccreditation,
  dulyMake
} from '../support/re-accreditation-journey.js'
import { raiseQuery, resumeFromQuery } from '../support/query-resubmission.js'
import {
  farFutureDeadline,
  farFutureDeadlineDate
} from '../support/sla-extend-date.js'

/**
 * RA-523 (final redesign) — a query answered on an ALREADY-DULY-MADE
 * application lands the item DECISION-READY, with no forward button.
 *
 * TOM'S FINAL REQUIREMENT. When an operator answers a query on an application
 * that had already been duly made, the regulator should get it back ready to
 * decide — make a determination or re-query — NOT a waypoint offering a
 * "Start assessment" / "Payment received" button to click first. There is no
 * work left to "start": the item was duly made before it was ever queried, so
 * the payment date and the SLA clock already exist.
 *
 * HOW THE BACKEND DELIVERS IT (verified against management-be on this branch,
 * not taken on trust):
 *
 *   - `resume-during-duly-made` now retargets `queried -> assessment-in-progress`
 *     DIRECTLY (it used to go `queried -> updated`). Confirmed in
 *     `ReAccreditationTypeTests` and `ReAccreditationType.cs`.
 *   - the whole forward-hop apparatus that USED to carry a `duly-made`-origin
 *     `updated` item on to assessment is DELETED: the
 *     `payment-received-during-duly-made` transition, the
 *     `ReAccreditationPaymentReceivedService`, and the bespoke
 *     `POST /work-items/re-accreditation/{id}/payment-received` endpoint are
 *     all gone (no references remain; the endpoint is absent from
 *     `ReAccreditationEndpoints`). management-fe deletes the matching CTA.
 *   - the querying caseworker is still re-assigned on resume
 *     (`RestoreQuerierAssignmentAsync`, unchanged) — but for this journey the
 *     caseworker never lost the item: querying self-assigned them.
 *
 * RA-595 REMOVED THE START CONTROL RA-523 ADDED. RA-523's original half
 * offered a caller who already HOLDS a duly-made item a separate start
 * control (`start-work-submit`, "Payment received" and later "Assessment
 * started") instead of "Assign to yourself and start". That control is gone:
 * a duly-made item now offers Make Determination, Query and Change
 * determination deadline directly, whoever holds it, and submitting a
 * determination or a deadline change starts the assessment. The blocks below
 * assert the holder gets those actions, and no start button of any kind.
 *
 * WHY EVERY STATE ASSERTION READS `data-state-id`, NEVER THE STATUS TAG:
 * RA-324 AC06 gives `assessment-in-progress` and `updated` the SAME display
 * name "Updated". A tag assertion across the retarget would pass vacuously
 * whether or not the transition fired, so the raw id (`assertStateId`) is the
 * only honest witness.
 *
 * The middle leg of every query round trip is an API call for the reason
 * `query-resubmission.js` documents: `queried -> {updated,assessment}` is
 * driven by the OPERATOR resubmitting, and case management has no affordance
 * for it by design.
 */

/** The stub login identity — see `login.page.js`. */
const CALLER = 'Stub Caseworker One'

/**
 * The decision-ready assertion for the redesign: the actions the regulator
 * SHOULD see, and the forward button they must NOT.
 *
 * The absences are paired with POSITIVE hooks on purpose, following the
 * RA-358 precedent: the actions panel must demonstrably have projected its
 * decision and query affordances, or the "no forward button" assertions would
 * pass just as happily against a page that failed to render the actions panel
 * at all — going green for a reason with no connection to the behaviour.
 *
 * The forward hop leaves no dedicated testid to target any more (transition,
 * endpoint and CTA are all deleted), so its absence is asserted on the LABELS
 * a caseworker would read — "Start assessment" and "Payment received" — plus
 * the "Duly make" CTA, which would also be wrong here.
 */
async function assertDecisionReadyNoForwardCta() {
  await expect(detail.actionsPanel()).toBeDisplayed()
  // Decision-ready: the regulator can determine, and can still re-query.
  expect(await detail.hasLogDecisionCta()).toBe(true)
  expect(await detail.hasAction('query')).toBe(true)
  // No forward hop, in any of its shapes, anywhere on the page. The old CTA
  // read "Start assessment"; the removed RA-410 start control read "Payment
  // received" and briefly "Assessment started".
  expect(await detail.pageControlLabels()).not.toContain('Start assessment')
  await detail.assertNoStartControl()
  // Already duly made — the Duly make CTA must not reappear.
  expect(await detail.hasDulyMakeCta()).toBe(false)
}

/**
 * RA-595. A duly-made item the caller holds offers the Duly made actions
 * directly — Make Determination, Query and Change determination deadline —
 * and no start button of any kind, nor "Assign to yourself and start" (the
 * RA-523 defect: offering to assign the caller something they already hold).
 *
 * The absences are paired with those positive hooks for the RA-358 reason: an
 * absence-only assertion would also pass if the page never rendered.
 */
async function assertHeldDulyMadeOffersActionsNoStart(workItemId) {
  await expect(detail.assignmentPanel()).toBeDisplayed()
  expect(await detail.hasLogDecisionCta()).toBe(true)
  expect(await detail.hasAction('query')).toBe(true)
  await slaExtend.assertActionLinkFor(workItemId)
  expect(await detail.hasAssignmentControl('reassign')).toBe(true)
  expect(await detail.hasAssignmentControl('unassign')).toBe(true)
  expect(await detail.hasAssignmentControl('selfAssign')).toBe(false)
  await detail.assertNoStartControl()
}

describe('RA-523 final — a queried duly-made item lands decision-ready', () => {
  let workItemId
  let dueOnBefore

  before(async () => {
    await login.login()
    // RA-299: a bare landing defaults to assigned-to-me, which would hide a
    // freshly created — and therefore unassigned — item.
    await workItems.resetFilters()
    ;({ id: workItemId } = await createReAccreditation(
      'RA-523 Decision Ready Route1 Ltd'
    ))
    // Duly make it while it is still held by NOBODY. This is the precondition
    // that makes the redesign observable: the item is duly made (payment date
    // captured, SLA clock running) BEFORE it is queried, and it is the QUERY
    // that later takes ownership.
    await dulyMake(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('starts out duly-made, held by nobody, with a running clock', async () => {
    // The precondition, asserted rather than assumed. If the item arrived here
    // already assigned, the query below would not be what took ownership; if
    // the clock were not already running, "the deadline is untouched" later
    // would be satisfied by two em-dashes.
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('duly-made')
    await detail.assertUnassigned()
    expect(await detail.hasRealDueOn()).toBe(true)
    // Captured now, before the query round trip, so the SLA assertion at the
    // end compares against a real observed value the payment date anchored
    // rather than a recomputed expectation.
    dueOnBefore = await detail.caseHeaderFieldText('dueOn')
  })

  it('querying it takes ownership', async () => {
    // Through the query page, not the API: the self-assignment under test is a
    // side effect of the caseworker's own action (RA-291), and driving it any
    // other way would arrange the very thing being observed.
    await raiseQuery(workItemId, {
      reason: 'RA-523: please resend the business plan with the tonnage split.'
    })
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('queried')
    await detail.assertAssignedTo(CALLER)
  })

  it('comes back in assessment-in-progress, held by the querying caseworker', async () => {
    // THE HEART OF THE FINAL REDESIGN. `resume-during-duly-made` retargets the
    // resume straight to `assessment-in-progress` — no `updated` waypoint, no
    // forward button — so the operator's answer to a query on an
    // already-duly-made application lands it decision-ready.
    //
    // Read from `data-state-id`, never the status tag: RA-324 AC06 gives
    // `assessment-in-progress` and `updated` the same display name "Updated",
    // so the visible tag does not change across the retarget and a spec
    // trusting it would pass whether or not the transition fired.
    await resumeFromQuery(workItemId)
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('assessment-in-progress')
    // The ticket's whole point: the caseworker who raised the query still
    // holds the case that answers it.
    await detail.assertAssignedTo(CALLER)
  })

  it('is decision-ready with no forward CTA of any kind', async () => {
    // Determination and re-query offered; no "Start assessment", no "Payment
    // received", no "Duly make", no assignment-panel start control.
    await assertDecisionReadyNoForwardCta()
  })

  it('kept the determination deadline the payment date anchored', async () => {
    // The SLA clock is anchored to the payment date entered at duly making, so
    // arriving decision-ready must not disturb it. Compared against the value
    // observed before the query round trip rather than a recomputed
    // expectation, which would just reimplement the backend's arithmetic and
    // agree with itself.
    expect(await detail.hasRealDueOn()).toBe(true)
    expect(await detail.caseHeaderFieldText('dueOn')).toBe(dueOnBefore)
  })
})

describe('RA-523 final — Flow B untouched: a submitted-origin query still needs Duly make', () => {
  // THE REGRESSION GUARD, and the proof the retarget is scoped correctly. This
  // item is queried BEFORE it is ever duly made, so it resumes to `updated`
  // with a submitted origin — NOT to assessment. The retarget is scoped to the
  // `duly-made` origin (`resume-during-duly-made`); a widening of that scope
  // would let a submitted-origin item reach assessment with NO payment date
  // captured and therefore NO SLA CLOCK EVER STARTED. Duly making is the only
  // correct way forward here, exactly as before the redesign.
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    ;({ id: workItemId } = await createReAccreditation(
      'RA-523 Decision Ready Route2 Ltd'
    ))
    // Queried while still `submitted`; the operator answers and it comes back
    // in `updated` carrying `originStateId: 'submitted'`.
    await raiseQuery(workItemId, {
      reason: 'RA-523: please confirm the payment reference before we proceed.'
    })
    await resumeFromQuery(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('sits in updated, held by the caseworker who queried it', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('updated')
    await detail.assertAssignedTo(CALLER)
  })

  it('offers "Duly make" and is NOT decision-ready', async () => {
    // Duly making captures the payment date and anchors the SLA clock, so it
    // is the sole route forward. And because this item never went through
    // assessment, it must NOT be decision-ready — no determination CTA, and no
    // forward "Start assessment" hop leaking in from the retarget.
    expect(await detail.hasDulyMakeCta()).toBe(true)
    expect(await detail.countActionsLabelled('Start assessment')).toBe(0)
    expect(await detail.hasLogDecisionCta()).toBe(false)
  })

  it('duly making it lands in duly-made, still held by the caseworker', async () => {
    // `dulyMake` drives the real CTA and the payment-date page. Assignment is
    // untouched by that journey: the caller arrives in `duly-made` already
    // holding the item.
    await dulyMake(workItemId)
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('duly-made')
    await detail.assertAssignedTo(CALLER)
  })

  it('offers the Duly made actions, no start button and NOT "Assign to yourself and start"', async () => {
    // RA-595: the caller already holds it, so there is nothing to assign, and
    // the actions Duly made offers start the assessment when submitted.
    await assertHeldDulyMadeOffersActionsNoStart(workItemId)
  })
})

describe('RA-523 final — an updated item held by the caseworker offers no self-assign or start button', () => {
  // THIS BLOCK PASSED BEFORE THE REDESIGN TOO, and that is why it is here.
  //
  // The caller already holds the item, so there is no self-assign, and no
  // start button renders in any state (RA-595). Locking that down
  // means a future regression in this state cannot be waved away as fallout
  // from the redesign — the redesign did not touch it.
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    ;({ id: workItemId } = await createReAccreditation(
      'RA-523 Decision Ready Updated Ltd'
    ))
    await raiseQuery(workItemId, {
      reason: 'RA-523: please attach the sampling plan.'
    })
    await resumeFromQuery(workItemId)
    await workItems.openWorkItem(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('is updated and held by the caseworker', async () => {
    await detail.assertStateId('updated')
    await detail.assertAssignedTo(CALLER)
  })

  it('renders neither self-assign nor start', async () => {
    // Both absences are guarded by a positive hook, for the RA-358 reason: the
    // panel must demonstrably be there, offering its ordinary reassign
    // affordance, or two absences would be satisfied by a page that simply
    // failed to render the panel at all.
    await expect(detail.assignmentPanel()).toBeDisplayed()
    expect(await detail.hasAssignmentControl('reassign')).toBe(true)
    expect(await detail.hasAssignmentControl('selfAssign')).toBe(false)
    await detail.assertNoStartControl()
  })
})

describe('RA-595 — the assignee of a duly-made item works it from Duly made', () => {
  // The case RA-523's start control existed for: the caller holds a duly-made
  // item (here because a colleague assigned it to them; equally because a
  // self-assign landed its assign half and not its start). RA-595 removed that
  // control. The caller is not stranded: Duly made offers the assessment
  // actions directly, and changing the deadline starts the assessment.
  //
  // Reached by assigning the duly-made item through the reassign interstitial:
  // it is the shortest honest way to "held by the caller, in `duly-made`".
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    ;({ id: workItemId } = await createReAccreditation(
      'RA-523 Decision Ready Drive Ltd'
    ))
    await dulyMake(workItemId)
    await workItems.openWorkItem(workItemId)
    await detail.assignTo('stub-caseworker-1')
  })

  after(async () => {
    await login.logout()
  })

  it('offers the Duly made actions and no start button once held by the caller', async () => {
    await detail.assertStateId('duly-made')
    await detail.assertAssignedTo(CALLER)
    await assertHeldDulyMadeOffersActionsNoStart(workItemId)
  })

  it('changing the deadline starts the assessment and keeps the caller assigned', async () => {
    await slaExtend.changeDeadline(workItemId, {
      reason: 'RA-595: deadline changed by the assignee from Duly made',
      date: farFutureDeadline()
    })
    await detail.assertStateId('assessment-in-progress')
    // Already held, so nothing was assigned: the caller keeps the case.
    await detail.assertAssignedTo(CALLER)
    await detail.assertCaseHeaderDueOn(farFutureDeadlineDate())
  })

  it('keeps every Duly made control once assessment has started', async () => {
    // The same controls the first `it` saw in Duly made — Make
    // Determination, Query, Change determination deadline, reassign and
    // unassign — and still no self-assign (the caller holds it) or start
    // button. The detail page has no notes control in either state.
    await assertHeldDulyMadeOffersActionsNoStart(workItemId)
  })
})

describe('RA-523 final — a duly-made item held by a COLLEAGUE still offers self-assign', () => {
  // The ownership negative, and the guard against over-correcting.
  //
  // RA-523 narrowed `canSelfAssign` to `!callerIsAssignee`. Narrowing it any
  // further — to "unassigned only", say — would break taking over a
  // colleague's case, which RA-323 makes legitimate. Here the caller is NOT
  // the assignee, so "Assign to yourself and start" is honest and must still
  // be offered, alongside the Duly made actions.
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    ;({ id: workItemId } = await createReAccreditation(
      'RA-523 Decision Ready Colleague Ltd'
    ))
    await dulyMake(workItemId)
    await workItems.openWorkItem(workItemId)
    await detail.assignTo('stub-caseworker-2')
  })

  after(async () => {
    await login.logout()
  })

  it('is duly-made and held by the other caseworker', async () => {
    await detail.assertStateId('duly-made')
    await detail.assertAssignedTo('Stub Caseworker Two')
  })

  it('still offers "Assign to yourself and start" and the Duly made actions, and no Payment received', async () => {
    await expect(detail.assignmentPanel()).toBeDisplayed()
    expect(await detail.hasAssignmentControl('selfAssign')).toBe(true)
    expect(await detail.hasLogDecisionCta()).toBe(true)
    expect(await detail.hasAction('query')).toBe(true)
    await slaExtend.assertActionLinkFor(workItemId)
    await detail.assertNoStartControl()
  })

  it('taking it over assigns AND starts, exactly as before', async () => {
    // The two-operation button is still correct HERE, because both operations
    // genuinely apply: the caller does not hold the item and the item has not
    // started. This is the behaviour RA-410 built and RA-523 left alone.
    await detail.selfAssignAndStart()
    await detail.assertStateId('assessment-in-progress')
    await detail.assertAssignedTo(CALLER)
  })
})
