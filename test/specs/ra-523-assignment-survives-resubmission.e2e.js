import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import queryPage from '../page-objects/query.page.js'
import { createReAccreditation } from '../support/re-accreditation-journey.js'
import { raiseQuery, resumeFromQuery } from '../support/query-resubmission.js'

// eslint-disable-next-line local-rules/no-undocumented-service-acronyms -- verbatim Jira ticket title, predates this guard
/**
 * RA-523 — "CM: Updated application status is not assigned to the regulator".
 *
 * THE BUG, in the reporter's words: a caseworker queries an application that
 * nobody holds. Querying takes ownership (the query page says so). The
 * operator then updates and resubmits; the application moves on to
 * `updated` — but the caseworker who raised the query no longer holds it, so
 * the case falls out of their "assigned to me" list and nobody is on the hook
 * for the answer they asked for.
 *
 * WHAT IS ACTUALLY NEW HERE. Two of the five ACs are already asserted
 * elsewhere and are re-asserted below only as the run-up this regression
 * needs — deliberately, because an unassigned-at-query-time item is the
 * precondition of the bug and a spec that assumed it would go green for the
 * wrong reason if the precondition quietly stopped holding:
 *
 *   - the conditional query-page notice is RA-295 AC04's subject and is
 *     owned by `ra-295-assignment-and-query.e2e.js` (both directions);
 *   - "querying an unassigned application assigns it to you" and the query
 *     form's validation are owned by `ra-291-query-application.e2e.js`.
 *
 * Nothing else in the suite looks at the assignee ACROSS the
 * `queried` → `updated` transition — `ra-316-duly-making-from-updated.e2e.js`
 * drives the same query → resubmit round trip but only ever asserts the
 * state and the CTA, so the assignee could be dropped there and the whole
 * suite would stay green.
 *
 * THIS FIRST BLOCK IS THE NO-REGRESSION CASE, NOT THE BUG. It passes against
 * an unfixed backend, and that is the finding rather than a gap: an
 * uninterrupted query round trip keeps its assignee already. The regression
 * needs a case that is dropped mid-query, and lives in the second block
 * below — read its comment for the root cause before changing anything here.
 * Keep this block: it is what stops a fix to that one from breaking the
 * ordinary path.
 *
 * WHY THE MIDDLE LEG IS AN API CALL. `queried` → `updated` is driven by the
 * OPERATOR resubmitting, via
 * `POST /work-items/re-accreditation/{id}/resume-from-query`. There is no
 * case-management affordance for it by design — a caseworker cannot resubmit
 * on the operator's behalf — so `resumeFromQuery` calls management-be
 * directly, as every other spec that needs `updated` does.
 */
describe('RA-523 assignment survives query and re-submission', () => {
  const orgPrefix = 'RA-523 Query Assignment Ltd'
  let workItemId

  before(async () => {
    await login.login()
    // RA-299: a bare landing defaults to assigned-to-me, which would hide a
    // freshly created — and therefore unassigned — item.
    await workItems.resetFilters()
    workItemId = await createReAccreditation(orgPrefix)
    await workItems.openWorkItem(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  describe('AC01 — an unassigned application warns that querying takes ownership', () => {
    it('starts out held by nobody', async () => {
      // The precondition of the entire bug, asserted rather than assumed.
      // Every later assertion in this file is meaningless if the item
      // arrives here already assigned.
      await detail.assertUnassigned()
    })

    it('shows the assignment notice on the query page', async () => {
      await queryPage.gotoFor(workItemId)
      await expect(queryPage.assignmentNotice()).toBeDisplayed()
      // RA-434 rewrote this copy — it used to read "When you send the query,
      // the application will also be assigned to you." The behaviour it
      // describes is unchanged; only the sentence moved. RA-295 AC04 owns
      // this string and also owns the negative half (the notice is absent on
      // an already-assigned application), so if the copy changes again, fix
      // it there first and follow it here.
      await expect(queryPage.assignmentNotice()).toHaveText(
        expect.stringContaining('The operator query status will be updated.')
      )
    })
  })

  describe('AC05 — an invalid query is rejected before any of that happens', () => {
    // Runs BEFORE the real query, on the same application, so the "nothing
    // moved" half can be asserted against an application that is still in
    // its opening state. Run after the query it would prove nothing: the
    // item would already be queried and assigned for legitimate reasons.
    it('rejects a query with no areas selected', async () => {
      await queryPage.gotoFor(workItemId)
      await queryPage.fillReason('Please resend the business plan.')
      await queryPage.submit()
      await queryPage.assertErrorSummaryDisplayed()
      expect(await queryPage.errorSummaryText()).toContain(
        'Select which areas you want to query'
      )
    })

    it('leaves the application unqueried and still unassigned', async () => {
      // The half with teeth. A rejected query must not half-apply: no state
      // change AND no assignment. The assignment is the part this ticket
      // cares about — taking ownership on a submission the backend then
      // refuses would hand the caseworker a case they never successfully
      // queried.
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Not started')
      await detail.assertUnassigned()
    })
  })

  describe('AC02 — sending the query assigns the application to its author', () => {
    before(async () => {
      // Goes through the query page rather than the API: the query is the
      // caseworker's own action, and the assignment under test is a side
      // effect of that action rather than something a spec should arrange.
      await raiseQuery(workItemId, {
        sections: ['business-plan'],
        reason: 'Please resend the business plan with the tonnage breakdown.'
      })
      await workItems.openWorkItem(workItemId)
    })

    it('moves the application to queried', async () => {
      await detail.assertStateId('queried')
      await detail.assertState('Queried')
    })

    it('assigns it to the caseworker who raised the query', async () => {
      // RA-323: the stub login identity is the first caseworker.
      await detail.assertAssignedTo('Stub Caseworker One')
    })
  })

  describe('AC03/AC04 — the operator answers and the application comes back', () => {
    before(async () => {
      await resumeFromQuery(workItemId)
      await workItems.openWorkItem(workItemId)
    })

    it('AC03: moves the application to updated', async () => {
      // Asserted on the raw state id, not the label: `updated` and
      // `assessment-in-progress` deliberately share the display name
      // "Updated" (RA-324 AC06), so the label alone cannot tell them apart
      // and a spec built on it could pass against the wrong state entirely.
      // The label is asserted too, because it is what a regulator sees.
      await detail.assertStateId('updated')
      await detail.assertState('Updated')
    })

    it('AC04: still held by the caseworker who raised the query', async () => {
      // THE REGRESSION. Before the fix this read "Unassigned": the
      // resubmission rebuilt the work item without carrying the assignee
      // across, so the caseworker who asked the question lost the case that
      // answered it.
      await detail.assertAssignedTo('Stub Caseworker One')
    })

    it('AC04: shows the same assignee on the work-items list', async () => {
      // The detail page and the list are separate read models, and the list
      // is where a caseworker would actually notice the case had gone
      // missing — "assigned to me" is a list filter, not a detail view. A
      // fix that only repaired the detail page would still leave the case
      // invisible where it matters, so both are asserted.
      await workItems.resetFilters()
      await workItems.searchByOrgName(orgPrefix)
      await expect(workItems.tileFor(workItemId)).toBeDisplayed()
      await expect(workItems.tileAssignedTo(workItemId)).toHaveText(
        expect.stringContaining('Stub Caseworker One')
      )
    })
  })
})

/**
 * RA-523 — THE ACTUAL REGRESSION: an application dropped WHILE it is
 * queried must come back owned by the caseworker who raised the query.
 *
 * The block above does not fail against an unfixed backend, and that is not
 * an oversight — it is the finding that located the bug. Assignment is never
 * cleared on the resume path (management-be has exactly one writer that
 * clears `AssignedToId`: the explicit unassign endpoint), so a query round
 * trip that nobody interferes with keeps its assignee on every one of the
 * four query origins. Confirmed empirically here and by management-be's own
 * integration tests across all four.
 *
 * The discriminator is NOT the origin state. It is WHETHER THE APPLICATION
 * IS ASSIGNED AT THE MOMENT THE RESUME LANDS:
 *
 *   - `ReAccreditationQueryService` self-assigns at query time (RA-291), and
 *     the query page promises it;
 *   - but that ownership is not durable across the query window. Case
 *     management offers "Unassign the application" UNCONDITIONALLY on any
 *     non-terminal item (RA-295 AC03 / RA-323), and `queried` is
 *     non-terminal — so a caseworker, or a supervisor tidying a worklist,
 *     can drop the case while the operator is still answering;
 *   - nothing re-established ownership on the way back in, so the
 *     application returned as `updated` and held by nobody. The same applies
 *     to any item that reached `queried` without an assign at all — in-flight
 *     data predating RA-291.
 *
 * The fix makes the resume restore the querying caseworker, resolved from
 * the `application-queried` audit entry, when — and only when — the item is
 * unassigned at that moment. Hence the third block below, which guards the
 * other half of that condition.
 *
 * Its own work item: the first block's item ends assigned and in `updated`,
 * and both are preconditions here that would then be false.
 */
describe('RA-523 assignment is restored when the case was dropped mid-query', () => {
  const orgPrefix = 'RA-523 Dropped Mid Query Ltd'
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    workItemId = await createReAccreditation(orgPrefix)
    await workItems.openWorkItem(workItemId)
    await detail.assertUnassigned()
    await raiseQuery(workItemId, {
      sections: ['business-plan'],
      reason: 'Please resend the business plan with the tonnage breakdown.'
    })
    await workItems.openWorkItem(workItemId)
    await detail.assertAssignedTo('Stub Caseworker One')
  })

  after(async () => {
    await login.logout()
  })

  it('lets a caseworker drop a queried application', async () => {
    // The step the ticket's own repro leaves implicit and the reason the
    // bug was hard to pin down. Driven through the UI affordance rather
    // than the API precisely because the affordance being available here is
    // half the cause — if management-fe ever gates unassign on `queried`,
    // this fails and the bug it guards has been fixed a different way.
    await detail.unassign()
    await detail.assertStateId('queried')
    await detail.assertUnassigned()
  })

  it('restores the querying caseworker when the operator resubmits', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. Against an unfixed management-be
    // this reads "Unassigned": the caseworker who asked the question does
    // not get back the case that answers it, and — because "assigned to me"
    // is the list filter caseworkers actually work from — nobody sees it.
    await resumeFromQuery(workItemId)
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('updated')
    await detail.assertAssignedTo('Stub Caseworker One')
  })

  it('shows the restored assignee on the work-items list too', async () => {
    // Detail and list are separate read models (`WorkItemResponse` vs
    // `WorkItemListItemResponse`), and the list is where the case would
    // actually be noticed missing. A fix that only repaired the detail page
    // would still leave it invisible where it matters.
    await workItems.resetFilters()
    await workItems.searchByOrgName(orgPrefix)
    await expect(workItems.tileFor(workItemId)).toBeDisplayed()
    await expect(workItems.tileAssignedTo(workItemId)).toHaveText(
      expect.stringContaining('Stub Caseworker One')
    )
  })
})

/**
 * RA-523 — the other half of the condition: a DELIBERATE hand-over during
 * the query window must survive the resume.
 *
 * The restore is conditional on the application being unassigned when the
 * resume lands. That condition is the whole safety margin of the fix, and it
 * is the kind of thing a later simplification quietly drops — "just always
 * assign the querier" reads like a tidy-up and passes every test above.
 *
 * It would also be wrong. A supervisor reassigning a queried case to a
 * colleague — because the querying caseworker is on leave, or the case has
 * been escalated — is an ordinary and deliberate act, and the operator's
 * answer arriving must not silently undo it. Without this block that
 * regression is unobservable.
 */
describe('RA-523 a deliberate hand-over during the query window is kept', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    workItemId = await createReAccreditation('RA-523 Handed Over Ltd')
    await workItems.openWorkItem(workItemId)
    await detail.assertUnassigned()
    await raiseQuery(workItemId, {
      sections: ['business-plan'],
      reason: 'Please resend the business plan.'
    })
    await workItems.openWorkItem(workItemId)
    // The query took ownership; a supervisor now hands the case on while
    // the operator is still answering.
    await detail.assertAssignedTo('Stub Caseworker One')
    await detail.assignTo('stub-caseworker-2')
    await detail.assertAssignedTo('Stub Caseworker Two')
  })

  after(async () => {
    await login.logout()
  })

  it('leaves the new owner in place rather than reverting to the querier', async () => {
    await resumeFromQuery(workItemId)
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('updated')
    // NOT "Stub Caseworker One". The restore fires only on an unassigned
    // application; here somebody already holds it, and their claim wins.
    await detail.assertAssignedTo('Stub Caseworker Two')
  })
})
