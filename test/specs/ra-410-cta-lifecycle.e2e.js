import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import decision from '../page-objects/decision.page.js'
import {
  createReAccreditation,
  driveToAssessmentInProgress,
  dulyMake,
  logDecision
} from '../support/re-accreditation-journey.js'

/**
 * RA-410 — the three green call-to-action buttons that replace Tasks.
 *
 * Tasks used to drive progress and status updates. That job now belongs to
 * three explicit CTAs on the work item detail page:
 *
 *   1. "Duly make"                  submitted              -> duly-made
 *   2. "Assign to yourself and start"  duly-made -> assessment-in-progress
 *   3. "Log decision" + Approved/Refused
 *                          assessment-in-progress -> approved / rejected
 *
 * `awaiting-decision` still exists in management-be's state machine but is an
 * INTERNAL HOP applied server-side inside the single decision call. One click
 * goes from assessment straight to a terminal state, so no assertion in this
 * file expects to observe it — and one deliberately proves it is not stopped
 * at.
 *
 * "REFUSED" IS A LABEL CHANGE ONLY. The underlying state id is still
 * `rejected`. Anything user-visible reads "Refused"; anything addressing the
 * backend keeps `rejected`. Both are asserted below, on purpose, because a
 * change that "tidied" one to match the other would break a contract in one
 * direction or a regulator's screen in the other.
 *
 * The Log decision page's own validation behaviour (missing radio, over-long
 * note) lives in ra-410-decision-validation.e2e.js, split out purely so wdio
 * can schedule the two halves on separate workers.
 */
describe('RA-410 The green CTA lifecycle', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('the full happy path, end to end', () => {
    let workItemId

    before(async () => {
      // The postcode must be unique across the whole suite — see
      // `createReAccreditation`. `SW1A 1AK` is unused elsewhere.
      workItemId = await createReAccreditation('CTA Happy Path', 'SW1A 1AK')
    })

    it('starts in submitted, offering only the Duly make CTA', async () => {
      await workItems.openWorkItem(workItemId)

      await detail.assertStateId('submitted')
      expect(await detail.hasDulyMakeCta()).toBe(true)
      // The later CTAs must not be offered out of order — a caseworker who
      // could log a decision on an unassessed application is the whole reason
      // these are sequenced.
      expect(await detail.hasLogDecisionCta()).toBe(false)
    })

    it('step 1: Duly make takes it to duly-made', async () => {
      await detail.clickDulyMake()
      await dulyMaking.assertOnPage()
      await dulyMaking.setPaymentDate({
        day: new Date().getDate(),
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear()
      })
      await dulyMaking.submit()
      await dulyMaking.waitForDetailUrl(workItemId)

      await detail.assertStateId('duly-made')
      await detail.assertState('Duly made')
      expect(await detail.hasDulyMakeCta()).toBe(false)
    })

    it('step 2: Assign to yourself and start takes it to assessment', async () => {
      expect(await detail.hasAssignmentControl('selfAssign')).toBe(true)
      await detail.selfAssignAndStart()

      await detail.assertStateId('assessment-in-progress')
      // `assessment-in-progress` and `updated` deliberately share the display
      // name "Updated" (RA-324), so the label alone cannot tell them apart —
      // hence the state-id assertion above carrying the real weight.
      await detail.assertState('Updated')
      // The button both assigns AND transitions; a version that only
      // transitioned would pass the state assertions and still be wrong.
      await detail.assertAssignedTo('Stub Caseworker One')
    })

    it('step 3: Log decision offers both outcomes', async () => {
      expect(await detail.hasLogDecisionCta()).toBe(true)
      // RA-447 (CM7): both the detail-page CTA and the decision page's own
      // submit button are renamed "Log decision" -> "Make Determination".
      // The testids are unchanged (see decision.page.js / work-item-detail
      // .page.js), so this is a text assertion, not an existence one.
      expect(await detail.logDecisionCtaText()).toBe('Make Determination')
      await detail.clickLogDecision()
      await decision.assertOnPage()
      // RA-447 (CM8): sentence-cased from "Make Determination" (CM7) to
      // "Make determination" for GOV.UK style consistency.
      expect(await decision.submitButtonText()).toBe('Make determination')

      // RA-447 (CM8): relabels "decision" as "determination" throughout.
      expect(await decision.warningTextText()).toBe(
        'This determination is final and it cannot be changed.'
      )
      expect(await decision.noteHintText()).toBe(
        'The determination will be recorded in the audit log (application history). Contact the applicant when the determination has been made.'
      )

      expect(await decision.hasOutcomeRadio('approved')).toBe(true)
      expect(await decision.hasOutcomeRadio('refused')).toBe(true)
      // Neither is preselected: a default would let a distracted caseworker
      // submit a determination they never chose.
      expect(await decision.isOutcomeSelected('approved')).toBe(false)
      expect(await decision.isOutcomeSelected('refused')).toBe(false)
    })

    it('step 3: Approved reaches the Granted terminal state', async () => {
      await decision.selectOutcome('approved')
      await decision.submit()
      await decision.waitForDetailUrl(workItemId)

      await detail.assertStateId('approved')
      await detail.assertState('Granted')
      await detail.assertApprovalPanelVisible()
      // RA-415 reworked the accreditation id format (was `ACC-2027-P-XXXXXXXX`).
      // Mirror the pattern management-be now generates — see the matching
      // assertion (and the note on why the trailing segment isn't asserted as
      // a specific material code) in re-accreditation-approval.e2e.js.
      expect(await detail.getAccreditationId()).toMatch(
        /^A\d{2}[ESNW][RX][A-Z0-9]{6}[A-Z0-9]{3}[A-Z]{2}$/
      )
    })

    it('does not park the item in awaiting-decision, and ends at approved', async () => {
      // The atomic decision, gated by the Registration & Accreditation service, discharges the awaiting-decision waypoint
      // SERVER-SIDE inside the single call, so the item is never left resting
      // there. What the audit history must show is the item ARRIVING at the
      // terminal state — asserting the real END STATE rather than the internal
      // hop, which is not a state the caseworker was ever stopped at.
      await detail.gotoAudit()
      const transitions = await detail.appliedTransitions()

      // appliedTransitions() renders the raw state-id edge, not the display
      // label ("Granted") — see the same convention in ra-316-duly-making.e2e.js
      // ('submitted → duly-made'). Whatever shape management-be gives the
      // internal hop in the history — a collapsed `assessment-in-progress →
      // approved` edge or a declared `… → approved` one — the terminal edge
      // lands on `approved`. Deliberately NOT asserting the intermediate
      // `→ awaiting-decision` edge: whether the audit surfaces the internal hop
      // is management-be's call, and the AC is that the item does not REST
      // there, not that the edge is invisible.
      expect(transitions.join(' | ')).toContain('→ approved')

      // ...and the item is emphatically not sitting in awaiting-decision now:
      // it is in the terminal state, with no affordance to rest at the waypoint.
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('approved')
    })

    it('withdraws every CTA once terminal', async () => {
      // Re-open the detail page: the previous `it` may have left the browser on
      // the audit log, and these assertions read the detail page directly.
      await workItems.openWorkItem(workItemId)
      expect(await detail.hasDulyMakeCta()).toBe(false)
      expect(await detail.hasLogDecisionCta()).toBe(false)
      await detail.assertNoDecisionActions()
      await detail.assertReadOnlyOutcomePanel('Granted')
    })
  })

  describe('Refused reaches the rejected terminal state', () => {
    let workItemId

    before(async () => {
      // `SW1A 1AW` is unused elsewhere — see `createReAccreditation`.
      workItemId = await createReAccreditation('CTA Refused Path', 'SW1A 1AW')
      await driveToAssessmentInProgress(workItemId)
    })

    it('records the refusal', async () => {
      await logDecision(workItemId, 'refused')
      // The state id is the backend contract and is unchanged by RA-410...
      await detail.assertStateId('rejected')
      // ...while what the regulator reads is the new label. Asserting both is
      // the point: the rename must be skin-deep.
      await detail.assertState('Refused')
    })

    it('issues no accreditation', async () => {
      // The two outcomes must not have been wired to the same handler. A slip
      // that approved on both radios would satisfy a state assertion alone if
      // the state were read from the request rather than the result.
      await detail.assertReadOnlyOutcomePanel('Refused')
      // No approval confirmation panel — and so no accreditation id — is
      // rendered for a refused item; that panel is built only for the
      // approved state, so its absence is what proves nothing was granted.
      await detail.assertNoApprovalPanel()
    })
  })

  describe('self-assign from a non-duly-made state does not transition', () => {
    // management-fe renders the assignment panel in EVERY non-closed state,
    // so "Assign to yourself and start" is on screen far more often than the
    // transition is legal. The handler applies `payment-received` ONLY from
    // `duly-made`; everywhere else it must take the case and nothing more.
    //
    // This is the trickiest guard in the story: the natural implementation —
    // "self-assign, then advance" — passes the happy path above and quietly
    // corrupts every other state.
    let submittedId

    before(async () => {
      // `SW1A 1AX` is unused elsewhere — see `createReAccreditation`.
      submittedId = await createReAccreditation('CTA Self Assign', 'SW1A 1AX')
    })

    it('assigns from submitted without changing state', async () => {
      await workItems.openWorkItem(submittedId)
      await detail.assertStateId('submitted')
      expect(await detail.hasAssignmentControl('selfAssign')).toBe(true)

      // Deliberately `selfAssign()`, not `selfAssignAndStart()` — the latter
      // waits for a transition that must not happen here and would mask the
      // bug as a timeout rather than reporting it as a wrong state.
      await detail.selfAssign()

      await detail.assertAssignedTo('Stub Caseworker One')
      await detail.assertStateId('submitted')
      // The Duly make CTA is still the next step, which is the user-visible
      // consequence of the state not having moved.
      expect(await detail.hasDulyMakeCta()).toBe(true)
    })

    it('assigns from assessment-in-progress without changing state', async () => {
      // The other side of the guard: an item PAST `duly-made` must not be
      // pushed on again by a reassignment.
      await detail.unassign()
      await dulyMake(submittedId)
      await workItems.openWorkItem(submittedId)
      await detail.selfAssignAndStart()
      await detail.assertStateId('assessment-in-progress')

      await detail.unassign()
      await detail.assertUnassigned()
      // Still in assessment after being released...
      await detail.assertStateId('assessment-in-progress')

      await detail.selfAssign()
      // ...and still in assessment after being taken again, rather than
      // having been advanced to a determination.
      await detail.assertAssignedTo('Stub Caseworker One')
      await detail.assertStateId('assessment-in-progress')
      expect(await detail.hasLogDecisionCta()).toBe(true)
    })

    it('records no spurious transition in the audit history', async () => {
      // A transition applied and immediately reverted would satisfy the state
      // assertions above. The history is where that would show.
      await detail.gotoAudit()
      const transitions = await detail.appliedTransitions()
      const toDecision = transitions.filter((t) => /Granted|Refused/.test(t))
      expect(toDecision).toEqual([])
    })
  })
})
