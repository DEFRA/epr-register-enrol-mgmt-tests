import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import queryPage from '../page-objects/query.page.js'
import {
  createReAccreditation,
  dulyMake,
  startAssessmentViaAction
} from '../support/re-accreditation-journey.js'
import { raiseQuery, resumeFromQuery } from '../support/query-resubmission.js'

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
 * The assertion this file exists for is the LAST one: after
 * `resume-from-query` the application is still held by the caseworker who
 * raised the query. Nothing else in the suite covers the assignee ACROSS
 * that transition — `ra-316-duly-making-from-updated.e2e.js` drives the same
 * query → resubmit round trip but only ever looks at the state and the CTA,
 * so the assignee could be silently dropped there and the whole suite would
 * stay green. That is exactly what happened.
 *
 * SCOPE — read before widening. This covers the UNASSIGNED-at-query-time
 * case only, which is the scenario on the ticket. Whether a resubmission
 * also (re)assigns an application that was already held by somebody else at
 * query time is a different question, is not what the bug reports, and is
 * not asserted here: doing so would pin down behaviour the fix does not
 * claim. If management-be later makes the resume-time assignment
 * unconditional, add that case rather than loosening this one.
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
 * RA-523 — the same round trip, but queried from a LATER origin state.
 *
 * WHY THIS SECOND ITEM EXISTS. The block above queries from the opening
 * state (`submitted`, displayed "Not started"). The ticket does not say
 * which state the application was in when it was queried, and management-be
 * offers four query origins — `submitted`, `duly-made`,
 * `assessment-in-progress` and `awaiting-decision` — each with its own
 * `query-during-*` action and its own `resume-during-*` action back out.
 * A round trip that keeps the assignee on one of those edges says nothing
 * about the others unless the mechanism is shared, so the origin furthest
 * from the first is exercised too.
 *
 * `startAssessmentViaAction`, NOT `startAssessment`. The normal route into
 * assessment is the "Assign to yourself and start" CTA, which — as the name
 * says — takes the case. That would destroy the precondition this whole file
 * is built on: the ticket is explicit that the application must be
 * UNASSIGNED when the query is raised ("do NOT assign the application to the
 * case worker first"). `startAssessmentViaAction` drives the same transition
 * through the `payment-received` action and leaves assignment alone, so the
 * application arrives in `assessment-in-progress` still held by nobody.
 *
 * Its own work item rather than a second pass over the first: the first item
 * ends the block above sitting in `updated` and already assigned, and both
 * of those are preconditions here that would then be false.
 */
describe('RA-523 assignment survives a query raised during assessment', () => {
  const orgPrefix = 'RA-523 Assessment Query Ltd'
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    workItemId = await createReAccreditation(orgPrefix)
    await dulyMake(workItemId)
    await startAssessmentViaAction(workItemId)
    await workItems.openWorkItem(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('reaches assessment with the application still held by nobody', async () => {
    // The precondition, and the reason `startAssessmentViaAction` is used
    // above. If this fails, the rest of the block is asserting against the
    // already-assigned case and proves nothing about the ticket.
    await detail.assertStateId('assessment-in-progress')
    await detail.assertUnassigned()
  })

  it('assigns the application on query, as it does from submitted', async () => {
    await raiseQuery(workItemId, {
      sections: ['prn-tonnage'],
      reason: 'Please confirm the PRN tonnage figures before we can assess.'
    })
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('queried')
    await detail.assertAssignedTo('Stub Caseworker One')
  })

  it('still held by the querying caseworker once the operator resubmits', async () => {
    await resumeFromQuery(workItemId)
    await workItems.openWorkItem(workItemId)
    // RA-337: every `resume-during-*` action lands on the single `updated`
    // waypoint, so this is the same target as the submitted-origin round
    // trip even though it arrived by a different edge.
    await detail.assertStateId('updated')
    await detail.assertAssignedTo('Stub Caseworker One')
  })
})
