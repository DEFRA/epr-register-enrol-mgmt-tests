import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  createReAccreditation,
  dulyMake
} from '../support/re-accreditation-journey.js'
import { raiseQuery, resumeFromQuery } from '../support/query-resubmission.js'

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
 * WHY THE RA-410 `payment-received` ACTION IS A DIFFERENT THING and survives:
 * that is the `duly-made -> assessment-in-progress` start control a caller who
 * already HOLDS a duly-made item clicks (assignment-panel `start-work-submit`,
 * label "Payment received"). RA-523's original half — offering that start
 * control instead of "Assign to yourself and start" — is untouched by this
 * redesign, so the recovery / colleague-ownership blocks below still exercise
 * it. Only the FORWARD hop out of the query round trip is gone.
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
 * the two other forward affordances that would be wrong here: the "Duly make"
 * CTA and the assignment-panel start control.
 */
async function assertDecisionReadyNoForwardCta() {
  await expect(detail.actionsPanel()).toBeDisplayed()
  // Decision-ready: the regulator can determine, and can still re-query.
  expect(await detail.hasLogDecisionCta()).toBe(true)
  expect(await detail.hasAction('query')).toBe(true)
  // No forward hop, in any of its shapes. The old CTA read "Start assessment";
  // the RA-410 start control reads "Payment received" — neither belongs on a
  // decision-ready item, and both are absent from the actions panel.
  expect(await detail.countActionsLabelled('Start assessment')).toBe(0)
  expect(await detail.countActionsLabelled('Payment received')).toBe(0)
  // Already duly made — the Duly make CTA must not reappear.
  expect(await detail.hasDulyMakeCta()).toBe(false)
  // `assessment-in-progress` is not a `startsOnSelfAssign` state, so the
  // assignment-panel start control must be absent too.
  expect(await detail.hasAssignmentControl('startWork')).toBe(false)
}

/**
 * The RA-523-original start-control fix, asserted against a `duly-made` item
 * the caller holds. UNCHANGED by the final redesign and re-used by the
 * recovery / regression blocks below.
 *
 * The absence of the self-assign button is paired with positive hooks (panel
 * present, start control present, its label correct) for the RA-358 reason —
 * an absence-only assertion would also pass if the panel never rendered.
 */
async function assertOffersStartNotSelfAssign() {
  await expect(detail.assignmentPanel()).toBeDisplayed()
  expect(await detail.hasAssignmentControl('startWork')).toBe(true)
  // The label is the fix, not an incidental detail: a regression that kept the
  // testid but restored "Assign to yourself and start" would reintroduce
  // exactly the confusion QA reported.
  expect(await detail.startWorkText()).toContain('Payment received')
  expect(await detail.hasAssignmentControl('selfAssign')).toBe(false)
}

describe('RA-523 final — a queried duly-made item lands decision-ready', () => {
  let workItemId
  let dueOnBefore

  before(async () => {
    await login.login()
    // RA-299: a bare landing defaults to assigned-to-me, which would hide a
    // freshly created — and therefore unassigned — item.
    await workItems.resetFilters()
    workItemId = await createReAccreditation('RA-523 Decision Ready Route1 Ltd')
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
    workItemId = await createReAccreditation('RA-523 Decision Ready Route2 Ltd')
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

  it('offers the start control and NOT "Assign to yourself and start"', async () => {
    // RA-523's original half, untouched by the redesign: a duly-made item the
    // caller already holds offers the start control ("Payment received"), not
    // a button proposing to assign them something they are already holding.
    await assertOffersStartNotSelfAssign()
  })
})

describe('RA-523 final — an updated item held by the caseworker offers no assignment start control', () => {
  // THIS BLOCK PASSED BEFORE THE REDESIGN TOO, and that is why it is here.
  //
  // `updated` is not a `startsOnSelfAssign` state, so neither control belongs
  // there: the caller already holds the item (no self-assign) and there is no
  // start transition leaving `updated` (no start control). Locking that down
  // means a future regression in this state cannot be waved away as fallout
  // from the redesign — the redesign did not touch it.
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    workItemId = await createReAccreditation(
      'RA-523 Decision Ready Updated Ltd'
    )
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
    expect(await detail.hasAssignmentControl('startWork')).toBe(false)
  })
})

describe('RA-523 final — the assignee of a duly-made item can still start the work', () => {
  // THE RA-410 RECOVERY CASE, which the redesign left intact.
  //
  // "Assign to yourself and start" is two operations. If the assign half lands
  // and the transition half does not, `callerIsAssignee` flips true and the
  // start action is filtered out of the actions panel — so the only thing that
  // can still start the work is the dedicated start control. RA-523's original
  // half provides it, and this drives it for real: asserting the button exists
  // is not enough.
  //
  // Reached by assigning the duly-made item through the reassign interstitial:
  // it is the shortest honest way to "held by the caller, in `duly-made`", and
  // it doubles as the case management-fe calls out — an item a COLLEAGUE
  // assigned to you.
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    workItemId = await createReAccreditation('RA-523 Decision Ready Drive Ltd')
    await dulyMake(workItemId)
    await workItems.openWorkItem(workItemId)
    await detail.assignTo('stub-caseworker-1')
  })

  after(async () => {
    await login.logout()
  })

  it('offers the start control once the item is held by the caller', async () => {
    await detail.assertStateId('duly-made')
    await detail.assertAssignedTo(CALLER)
    await assertOffersStartNotSelfAssign()
  })

  it('actually starts the assessment when clicked', async () => {
    await detail.startWork()
    await detail.assertStateId('assessment-in-progress')
    // The transition must not cost the caller the case — it is one operation,
    // and assignment is not one of the things it operates on.
    await detail.assertAssignedTo(CALLER)
  })

  it('drops the start control once the item has left duly-made', async () => {
    // `assessment-in-progress` is not a `startsOnSelfAssign` state, so the
    // control that got the item here must not linger and offer to do it again.
    // The self-assign button stays absent for the same reason it was before:
    // the caller still holds the item.
    await expect(detail.assignmentPanel()).toBeDisplayed()
    expect(await detail.hasAssignmentControl('startWork')).toBe(false)
    expect(await detail.hasAssignmentControl('selfAssign')).toBe(false)
  })
})

describe('RA-523 final — a duly-made item held by a COLLEAGUE still offers self-assign', () => {
  // The ownership negative, and the guard against over-correcting.
  //
  // RA-523 narrowed `canSelfAssign` to `!callerIsAssignee`. Narrowing it any
  // further — to "unassigned only", say — would break taking over a
  // colleague's case, which RA-323 makes legitimate. Here the caller is NOT
  // the assignee, so "Assign to yourself and start" is honest and must still
  // be offered, and the start control must NOT be: the caller has nothing to
  // start until they take the item.
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    workItemId = await createReAccreditation(
      'RA-523 Decision Ready Colleague Ltd'
    )
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

  it('still offers "Assign to yourself and start", and no start control', async () => {
    await expect(detail.assignmentPanel()).toBeDisplayed()
    expect(await detail.hasAssignmentControl('selfAssign')).toBe(true)
    expect(await detail.hasAssignmentControl('startWork')).toBe(false)
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
