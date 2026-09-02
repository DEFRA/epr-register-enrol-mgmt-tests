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
 * RA-523 (reopened) — a `duly-made` application the caseworker ALREADY HOLDS
 * must offer to START it, not to assign it to them again.
 *
 * QA, in their own words:
 *
 *   "when the user does not assign the work item to themselves in the first
 *   instance on a duly made work item, and then queries it, then after the
 *   query has been responded to, you get into this weird state where it
 *   offers for you to start and assign to yourself, but it should already be
 *   assigned"
 *
 *   "if the work item is not duly made, then on duly making an 'updated'
 *   ticket will then recreate the same faulty state."
 *
 * THIS WAS NEVER AN ASSIGNMENT-DATA BUG. Three rounds of backend
 * investigation established that the assignee survives the query round trip
 * intact — `ra-523-assignment-survives-resubmission.e2e.js` is the spec that
 * pins that half, and management-be is clean. The defect was purely what the
 * page OFFERED once the item came back: a `duly-made` item held by the caller
 * still rendered "Assign to yourself and start", a button proposing to assign
 * them something they were already holding, and whose label therefore lied
 * about the half of the work that was already done.
 *
 * THE FIX, and what this spec asserts about the markup:
 *
 *   - `canSelfAssign` is now strictly `!callerIsAssignee`, so
 *     `self-assign-submit` renders only for someone who does NOT hold the
 *     item;
 *   - a separate `start-work-submit` renders for a caller who DOES hold an
 *     item sitting in a `startsOnSelfAssign` state, performs ONE operation
 *     against the generic action route, and takes its label from the module's
 *     own transition `displayName` — "Payment received".
 *
 * WHY THIS FILE EXISTS AT ALL. Every self-assign spec in the suite passed on
 * an unfixed management-fe: `ra-153`, `ra-335`, `ra-358` and `ra-299` between
 * them only ever exercise UNASSIGNED items and CLOSED cases. Nothing covered
 * "the caller holds a `duly-made` item", which is precisely the state both QA
 * routes converge on — and that gap is why the defect shipped. Each block
 * below reaches that state by a different route and asserts the same pair of
 * facts, so a regression in either route is caught where it happens.
 *
 * The state assertions read the RAW state id (`assertStateId`) wherever
 * `updated` is involved: RA-324 gives `updated` and `assessment-in-progress`
 * the same display name, so the label alone cannot tell them apart.
 *
 * The middle leg of every query round trip is an API call for the reason
 * `query-resubmission.js` documents: `queried` -> `updated` is driven by the
 * OPERATOR resubmitting, and case management has no affordance for it by
 * design.
 */

/** The stub login identity — see `login.page.js`. */
const CALLER = 'Stub Caseworker One'

/**
 * Both halves of the fix, asserted together against an item the caller holds
 * in `duly-made`.
 *
 * The absences are paired with POSITIVE hooks on purpose, following the
 * RA-358 precedent in `assertNoUsableAssignmentAffordances`: an
 * absence-only assertion about `self-assign-submit` would also pass if the
 * assignment panel failed to render at all, or if the testids were renamed
 * out from under the suite — going green for a reason with no connection to
 * the behaviour. Requiring the panel AND the start control to be there makes
 * the absence of the self-assign button meaningful.
 */
async function assertOffersStartNotSelfAssign() {
  await expect(detail.assignmentPanel()).toBeDisplayed()
  expect(await detail.hasAssignmentControl('startWork')).toBe(true)
  // The label is the fix, not an incidental detail: a regression that kept
  // the new testid but restored "Assign to yourself and start" would
  // reintroduce exactly the confusion QA reported.
  expect(await detail.startWorkText()).toContain('Payment received')
  expect(await detail.hasAssignmentControl('selfAssign')).toBe(false)
}

describe('RA-523 QA route 1 — queried from duly-made, then Continue review', () => {
  let workItemId

  before(async () => {
    await login.login()
    // RA-299: a bare landing defaults to assigned-to-me, which would hide a
    // freshly created — and therefore unassigned — item.
    await workItems.resetFilters()
    workItemId = await createReAccreditation('RA-523 Start Control Route1 Ltd')
    // Duly make it while it is still held by NOBODY. This is the precondition
    // QA names first ("does not assign the work item to themselves in the
    // first instance on a duly made work item") and the reason the bug is
    // reachable: the item arrives in `duly-made` unassigned, and it is the
    // QUERY that later takes ownership.
    await dulyMake(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('starts out duly-made and held by nobody', async () => {
    // The precondition, asserted rather than assumed. If the item arrived
    // here already assigned, the query below would not be what took ownership
    // and the rest of this block would prove nothing about the reported bug.
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('duly-made')
    await detail.assertUnassigned()
  })

  it('querying it takes ownership', async () => {
    // Through the query page, not the API: the self-assignment under test is
    // a side effect of the caseworker's own action (RA-291), and driving it
    // any other way would arrange the very thing being observed.
    await raiseQuery(workItemId, {
      reason: 'RA-523: please resend the business plan with the tonnage split.'
    })
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('queried')
    await detail.assertAssignedTo(CALLER)
  })

  it('comes back as updated, still held by the caseworker', async () => {
    await resumeFromQuery(workItemId)
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('updated')
    await detail.assertAssignedTo(CALLER)
  })

  it('returns to duly-made on Continue review, still held by the caseworker', async () => {
    // The caseworker's OWN journey, not the API shortcut: the whole defect is
    // about what the page offers after a real Continue review, so the click
    // has to be real too.
    await detail.clickContinueReview()
    await detail.assertStateId('duly-made')
    await detail.assertAssignedTo(CALLER)
  })

  it('offers "Payment received" and NOT "Assign to yourself and start"', async () => {
    // THE BUG. Before the fix this page rendered `self-assign-submit`,
    // offering to assign the caseworker an application they had held since
    // they queried it.
    await assertOffersStartNotSelfAssign()
  })
})

describe('RA-523 QA route 2 — queried from submitted, then Duly make', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    workItemId = await createReAccreditation('RA-523 Start Control Route2 Ltd')
    // Queried BEFORE duly making — QA's second sentence. The item is still in
    // `submitted`, so the route back into `duly-made` is the Duly make CTA on
    // the `updated` item rather than Continue review (RA-454 suppresses
    // Continue review for this origin precisely so it cannot skip duly
    // making).
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

  it('duly making it lands in duly-made, still held by the caseworker', async () => {
    // `dulyMake` drives the real CTA and the payment-date page. Assignment is
    // untouched by that journey, which is the point: the caller arrives in
    // `duly-made` already holding the item.
    await dulyMake(workItemId)
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('duly-made')
    await detail.assertAssignedTo(CALLER)
  })

  it('offers "Payment received" and NOT "Assign to yourself and start"', async () => {
    // Same faulty state, reached the other way — "on duly making an 'updated'
    // ticket will then recreate the same faulty state".
    await assertOffersStartNotSelfAssign()
  })
})

describe('RA-523 control — an updated item held by the caseworker offers neither button', () => {
  // THIS BLOCK PASSED BEFORE THE FIX TOO, and that is why it is here.
  //
  // `updated` is not a `startsOnSelfAssign` state, so neither control has any
  // business rendering there: the caller already holds the item (no
  // self-assign) and there is no start transition leaving `updated` (no start
  // control). Locking that down now means a future regression in this state
  // cannot be waved away as fallout from RA-523's split — the split did not
  // touch it, and this spec is the evidence.
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    workItemId = await createReAccreditation('RA-523 Start Control Updated Ltd')
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
    // Both absences are guarded by positive hooks, for the RA-358 reason: the
    // panel must demonstrably be there, offering its ordinary reassign
    // affordance, or two absences would be satisfied by a page that simply
    // failed to render the panel at all.
    await expect(detail.assignmentPanel()).toBeDisplayed()
    expect(await detail.hasAssignmentControl('reassign')).toBe(true)
    expect(await detail.hasAssignmentControl('selfAssign')).toBe(false)
    expect(await detail.hasAssignmentControl('startWork')).toBe(false)
  })
})

describe('RA-523 — the assignee of a duly-made item can still start the work', () => {
  // THE RA-410 RECOVERY CASE, which the fix had to keep reachable.
  //
  // "Assign to yourself and start" is two operations. If the assign half
  // lands and the transition half does not, `callerIsAssignee` flips true and
  // `payment-received` is filtered out of the actions panel — so before
  // RA-523 the ONLY thing that could still start the work was the self-assign
  // button continuing to render for the assignee. RA-523 removed that clause,
  // and if the replacement control did not actually work the caller would be
  // stranded on a `duly-made` item with no way forward. Asserting the button
  // exists is not enough; this drives it.
  //
  // Reached by assigning the duly-made item through the reassign interstitial
  // rather than by another query round trip: it is the shortest honest way to
  // "held by the caller, in `duly-made`", and it doubles as the case
  // management-fe calls out — an item a COLLEAGUE assigned to you, which used
  // to offer "Assign to yourself and start" and now offers the start action.
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    workItemId = await createReAccreditation('RA-523 Start Control Drive Ltd')
    await dulyMake(workItemId)
    await workItems.openWorkItem(workItemId)
    await detail.assignTo('stub-caseworker-1')
  })

  after(async () => {
    await login.logout()
  })

  it('offers "Payment received" once the item is held by the caller', async () => {
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
    // control that got the item here must not linger and offer to do it
    // again. The self-assign button stays absent for the same reason it was
    // absent before: the caller still holds the item.
    await expect(detail.assignmentPanel()).toBeDisplayed()
    expect(await detail.hasAssignmentControl('startWork')).toBe(false)
    expect(await detail.hasAssignmentControl('selfAssign')).toBe(false)
  })
})

describe('RA-523 — a duly-made item held by a COLLEAGUE still offers self-assign', () => {
  // The ownership negative, and the guard against over-correcting.
  //
  // The fix narrows `canSelfAssign` to `!callerIsAssignee`. Narrowing it any
  // further — to "unassigned only", say — would break taking over a colleague's
  // case, which RA-323 makes legitimate for any caseworker. Here the caller is
  // NOT the assignee, so "Assign to yourself and start" is honest and must
  // still be offered, and the start control must NOT be: the caller has
  // nothing to start until they take the item.
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    workItemId = await createReAccreditation(
      'RA-523 Start Control Colleague Ltd'
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
