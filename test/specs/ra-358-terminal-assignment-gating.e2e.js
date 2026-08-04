import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  approveWorkItem,
  createWithdrawnWorkItem,
  driveToAwaitingDecision,
  rejectWorkItem
} from '../support/terminal-states.js'

/**
 * RA-358 (scope addition) — a closed case cannot be assigned.
 *
 * Tom found this while testing the withdrawn page: a withdrawn work item
 * still offered the full assignment panel, and "Assign to yourself and start"
 * genuinely worked — `POST /work-items/{id}/assign` returned 200 and assigned
 * the closed case. So this was never merely a cosmetic affordance the backend
 * would have rejected; the UI was the only gate and it was open.
 *
 * The fix is deliberately in both halves, and this spec covers both:
 *   - management-fe suppresses the three assignment affordances on a terminal
 *     work item;
 *   - management-be rejects assign/unassign on a terminal work item with a
 *     409, so the UI is not the only gate.
 *
 * SCOPE IS ALL THREE TERMINAL STATES — withdrawn, approved and rejected, not
 * withdrawn alone. All three are reachable through existing journeys, so all
 * three are covered here rather than inferring the other two from the
 * withdrawn case.
 *
 * THIS REVERSES RA-295 AC03, which required assignment to be available "all
 * the way through" so a closed case could still be handed over.
 *
 * PROVENANCE, stated plainly because it matters for a reversal of an accepted
 * AC: the scope decision reached this suite RELAYED (via the coordinating
 * session), not directly from Tom. The hand-over rationale was raised and is
 * reported to have been overridden with it on the table, but that
 * confirmation is second-hand from here. Recorded as relayed rather than
 * presented as settled, because during this same work a relayed decision was
 * quoted from a bead field that turned out to have been overwritten. If the
 * decision is reversed, the inverted case in
 * `ra-295-assignment-and-query.e2e.js` is the other half that reverts with
 * this file.
 */
describe('RA-358 — assignment is gated on terminal work items', () => {
  /**
   * management-fe SUPPRESSES the three affordances from the DOM on a
   * terminal item rather than reusing RA-335's inert-`<span>` pattern — that
   * pattern says "not you", which is right for a read-only user but wrong
   * here, where the action is meaningless for everyone.
   *
   * The assertions are still written against "no USABLE affordance" rather
   * than bare absence, and each is paired with the positive
   * `assignment-closed` hook. Absence alone passes vacuously if the panel
   * fails to render for an unrelated reason, which is exactly how a phantom
   * failure wasted time earlier in this work. See
   * `assertNoUsableAssignmentAffordances` in the detail page object.
   */
  describe('a withdrawn work item', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      ;({ id: workItemId } = await createWithdrawnWorkItem({
        organisationName: 'Terminal Gating Withdrawn Ltd',
        material: 'plastic'
      }))
    })

    after(async () => {
      await login.logout()
    })

    it('offers no usable assignment affordance', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Withdrawn')
      await detail.assertNoUsableAssignmentAffordances()
    })

    it('refuses the assign call even when the interstitial is reached directly', async () => {
      // The backend half, asserted through the only surface this suite has on
      // it. Navigating straight to the interstitial models both a stale link
      // and a hand-typed URL — the FE gate hides the affordance, so without
      // this the backend guard would be untested from here.
      //
      // Asserts the REFUSAL, not the wording: the 409's copy belongs to
      // management-be and is covered by its own tests. What matters here is
      // that the case does not end up assigned.
      await browser.url(`/work-items/${workItemId}/assign`)
      await detail.assertAssignRefused()
      await workItems.openWorkItem(workItemId)
      await detail.assertUnassigned()
    })
  })

  describe('an approved work item', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      workItemId = await driveToAwaitingDecision({
        organisationName: 'Terminal Gating Approved Ltd',
        material: 'paper'
      })
      await approveWorkItem(workItemId)
    })

    after(async () => {
      await login.logout()
    })

    it('offers no usable assignment affordance', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Granted')
      await detail.assertNoUsableAssignmentAffordances()
    })
  })

  describe('a rejected work item', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      workItemId = await driveToAwaitingDecision({
        organisationName: 'Terminal Gating Rejected Ltd',
        material: 'aluminium'
      })
      await rejectWorkItem(workItemId)
    })

    after(async () => {
      await login.logout()
    })

    it('offers no usable assignment affordance', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Refused')
      await detail.assertNoUsableAssignmentAffordances()
    })
  })

  /**
   * The regression guard. Gating on "terminal" is one predicate away from
   * gating on "not the initial state", and an over-broad gate would break the
   * normal caseworker journey without failing any of the cases above — every
   * assertion so far is a negative. This is the positive complement.
   *
   * assign-reassign-unassign.e2e.js proves the assignment journey end to end
   * and is left alone; this asserts the narrower thing that could regress
   * here, which is that the affordances still RENDER as live controls on an
   * open case.
   */
  describe('a non-terminal work item (regression guard)', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      ;({ id: workItemId } = await workItems.createWorkItem({
        organisationName: 'Terminal Gating Open Case Ltd',
        siteAddressLine1: '1 Open Way',
        siteAddressTown: 'York',
        siteAddressPostcode: 'YO1 2AG',
        material: 'plastic',
        tonnageBand: '0-500'
      }))
    })

    after(async () => {
      await login.logout()
    })

    it('still offers every assignment affordance', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Not started')
      expect(await detail.hasUsableAssignmentControl('selfAssign')).toBe(true)
      expect(await detail.hasUsableAssignmentControl('reassign')).toBe(true)
      expect(await detail.hasUsableAssignmentControl('unassign')).toBe(true)
    })

    it('can still actually be assigned', async () => {
      // The gate is on the write path too, so presence alone is not enough —
      // an over-broad backend guard would leave the links live and fail here.
      // Uses the same named stub caseworker as assign-reassign-unassign so
      // the assertion is on a real display name rather than a value the test
      // itself supplied.
      await workItems.openWorkItem(workItemId)
      await detail.assignTo('stub-caseworker-2')
      await detail.assertAssignedTo('Stub Caseworker Two')
    })
  })
})
