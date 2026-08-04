import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import queryPage from '../page-objects/query.page.js'
import withdrawPage from '../page-objects/withdraw.page.js'

/**
 * RA-295 (AC03 + AC04) — assignment stays reachable through the redesign, and
 * the query page's assignment promise becomes conditional.
 *
 * AC03: the redesign moves assignment into a bordered right-hand panel. The
 * risk it guards against is the panel only being wired up for the state the
 * designer had on screen — a freshly created, unassigned item — leaving a
 * caseworker unable to reassign or release an item once it is held. So each
 * control is asserted in the state where it is meaningful, INCLUDING the
 * "assigned to somebody else" state, which is the one a layout rewrite is
 * most likely to miss.
 *
 * AC04: the "When you send the query, the application will also be assigned to
 * you" content must show when the item is unassigned and must NOT show when it
 * is already assigned. Before RA-295 that inset text rendered
 * unconditionally, so the negative half is the test that actually has teeth —
 * the positive half alone passes against the old markup and could never fail.
 */
describe('RA-295 assignment panel and query assignment notice', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'RA-295 Assignment Panel Ltd',
      siteAddressLine1: '1 Panel Place',
      siteAddressTown: 'Leeds',
      siteAddressPostcode: 'LS1 1AA',
      material: 'plastic',
      tonnageBand: '0-500'
    }))
    await workItems.openWorkItem(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  describe('AC03 — assignment controls in the right-hand panel', () => {
    // management-fe confirmed the final matrix: "Reassign the application" and
    // "Unassign the application" are UNCONDITIONAL in every workflow and
    // assignment state; "Assign to yourself" renders whenever the signed-in
    // user is not already the assignee — so it is present when unassigned AND
    // when a colleague holds it (take-over), and absent only when the item is
    // already yours. That last case is the single conditional in the panel and
    // therefore the only one that can regress silently, so it gets its own
    // assertion rather than being folded into a loop.
    describe('while the item is unassigned', () => {
      it('shows the panel with no status line, per the prototype', async () => {
        await expect(detail.assignmentPanel()).toBeDisplayed()
        // The prototype's unassigned card carries no status line: "Unassigned"
        // there only restates the case header's "Assigned to" field, directly
        // above the button that resolves it. Paired with a positive assertion
        // on the header so this cannot pass by the whole page failing to load.
        await expect(detail.caseHeaderField('assignedTo')).toHaveText(
          expect.stringContaining('Unassigned')
        )
        expect(await detail.assignmentCurrent().isExisting()).toBe(false)
      })

      it('offers all three assignment affordances', async () => {
        for (const control of ['selfAssign', 'reassign', 'unassign']) {
          expect(await detail.hasAssignmentControl(control)).toBe(true)
        }
      })
    })

    describe('once the item is assigned to another caseworker', () => {
      before(async () => {
        // Assigned to somebody ELSE, not the signed-in user: the state where a
        // caseworker most needs reassign/unassign, and the one a panel wired
        // only for "my own item" would break. This is the "not just when
        // freshly unassigned" case.
        await detail.assignTo('stub-caseworker-2')
        await detail.assertAssignedTo('Stub Caseworker Two')
      })

      it('still offers all three affordances, including take-over', async () => {
        await expect(detail.assignmentPanel()).toBeDisplayed()
        for (const control of ['selfAssign', 'reassign', 'unassign']) {
          expect(await detail.hasAssignmentControl(control)).toBe(true)
        }
      })

      it('can actually reassign through the interstitial', async () => {
        // Presence is not the whole AC — the affordance has to work. AC03 made
        // reassign a LINK to a GET interstitial, so this drives the whole
        // link → picker → POST → redirect journey rather than eyeballing DOM.
        await detail.assignTo('stub-caseworker-3')
        await detail.assertAssignedTo('Stub Caseworker Three')
        await expect(detail.assignmentPanel()).toBeDisplayed()
      })
    })

    describe('once the item is assigned to the signed-in user', () => {
      before(async () => {
        await detail.assignmentControl('selfAssign').click()
        await detail.waitForDetailUrl()
      })

      it('reads "Assigned to you"', async () => {
        await expect(detail.assignmentCurrent()).toHaveText(
          expect.stringContaining('Assigned to you')
        )
      })

      it('drops "Assign to yourself" but keeps reassign and unassign', async () => {
        // The one conditional in the panel: offering to assign an item to the
        // person who already holds it is meaningless. Reassign and unassign
        // must survive, or a caseworker cannot hand the item on.
        expect(await detail.hasAssignmentControl('selfAssign')).toBe(false)
        expect(await detail.hasAssignmentControl('reassign')).toBe(true)
        expect(await detail.hasAssignmentControl('unassign')).toBe(true)
      })
    })
  })

  describe('AC04 — the query page assignment notice', () => {
    describe('when the application is already assigned', () => {
      // Continues from the AC03 block above, which left the item assigned to
      // the signed-in user. Asserted rather than assumed, so a change to the
      // block above surfaces here as a clear failure rather than as a
      // mysteriously passing negative test.
      before(async () => {
        await workItems.openWorkItem(workItemId)
        await expect(detail.assignmentCurrent()).toHaveText(
          expect.stringContaining('Assigned to you')
        )
        await queryPage.gotoFor(workItemId)
      })

      it('does not promise to assign the application to the querying user', async () => {
        // Telling a caseworker that querying "will also assign the application
        // to you" is simply false here — somebody already holds it.
        expect(await queryPage.hasAssignmentNotice()).toBe(false)
      })
    })

    describe('when the application is unassigned', () => {
      before(async () => {
        await workItems.openWorkItem(workItemId)
        await detail.unassign()
        await detail.assertUnassigned()
        await queryPage.gotoFor(workItemId)
      })

      it('tells the user that querying will also assign the application to them', async () => {
        await expect(queryPage.assignmentNotice()).toBeDisplayed()
        await expect(queryPage.assignmentNotice()).toHaveText(
          expect.stringContaining(
            'the application will also be assigned to you'
          )
        )
      })
    })
  })

  describe('the due-date links on a closed case', () => {
    // AC03's "available throughout" is about ASSIGNMENT, and reassign/unassign
    // are unconditional. The SLA due-date links are NOT, and that distinction
    // matters more than it looks: `SlaService.ExtendAsync` in management-be has
    // no terminal-state check, so it will accept a due-date change on a closed
    // case. The UI gate is the only thing preventing that, which makes this
    // the real backstop rather than a presentational detail.
    //
    // Uses its OWN work item, deliberately: withdrawing is irreversible, so
    // reusing the item above would leave every later block in this file
    // operating on a closed case. Withdraw is the shortest route to a terminal
    // state — one interstitial, rather than the whole approval journey.
    let closedItemId

    before(async () => {
      await workItems.resetFilters()
      ;({ id: closedItemId } = await workItems.createWorkItem({
        organisationName: 'RA-295 Closed Case Ltd',
        siteAddressLine1: '1 Closure Court',
        siteAddressTown: 'Hull',
        siteAddressPostcode: 'HU1 1AA',
        material: 'paper',
        tonnageBand: '0-500'
      }))
      // Drive the item to Assessment in progress FIRST. `sla-extend` is only
      // projected from that state, so withdrawing straight from `submitted`
      // would assert absence on links that had never rendered at any point —
      // the negative could not fail, and a regression where a terminal state
      // still projects `sla-extend` would sail through green.
      await workItems.openWorkItem(closedItemId)
      await detail.gotoTasks()
      await detail.setTaskStatus('verify-organisation-details', 'Completed')
      await detail.setTaskStatus(
        'confirm-application-completeness',
        'Completed'
      )
      await detail.gotoDetail()
      await detail.assertState('Duly made')
      await detail.gotoTasks()
      await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
      await detail.gotoDetail()
      await detail.triggerAction('payment-received')

      // The precondition, asserted rather than assumed: the links must be
      // present here, or the absence check below proves nothing.
      await expect($('[data-testid="action-sla-extend"]')).toBeExisting()
      await expect($('[data-testid="action-sla-override"]')).toBeExisting()

      // `withdraw` is the action id from `submitted` only — each later state
      // has its own (`withdraw-during-assessment` here). Now that this block
      // drives the item to Assessment in progress first, the default id no
      // longer resolves and the confirm page renders nothing.
      await withdrawPage.gotoFor(closedItemId, 'withdraw-during-assessment')
      await withdrawPage.fillNote('Closing the case to check the SLA gating')
      await withdrawPage.submit()
      await detail.waitForDetailUrl()
      await detail.assertState('Withdrawn')
    })

    it('hides the extend and override due-date links', async () => {
      await expect($('[data-testid="action-sla-extend"]')).not.toBeExisting()
      await expect($('[data-testid="action-sla-override"]')).not.toBeExisting()
    })

    it('no longer offers reassign or unassign (RA-358 reverses AC03 here)', async () => {
      // INVERTED BY RA-358, DELIBERATELY — this case used to assert the
      // opposite, that a closed case stays reassignable so it can be handed
      // over. That was RA-295 AC03's explicit rationale, and it is the reason
      // the gate was absent, so the reversal is recorded here rather than
      // left to look like someone quietly flipped a passing spec.
      //
      // WHY IT CHANGED: a withdrawn work item still offered "Assign to
      // yourself and start", and clicking it worked — POST
      // /work-items/{id}/assign returned 200 and really assigned the closed
      // case (found by Tom on the RA-358 local test; see bead epr-b4as). The
      // UI was the only gate and it was open. Assignment is now blocked on
      // ALL terminal states (withdrawn, approved, rejected), in both
      // management-fe (affordances suppressed) and management-be (409).
      //
      // The hand-over rationale above was raised against that change, with
      // this spec cited as evidence that AC03 was actively asserted and not
      // merely written down. Tom settled the scope with that on the table, so
      // the trade-off was made knowingly. Reverting this case is the other
      // half of reverting ra-358-terminal-assignment-gating.e2e.js if the
      // call is ever revisited.
      //
      // The panel itself REMAINS — it now explains that the case is closed,
      // and still shows who holds it, which is information rather than an
      // affordance. That distinction is the point of the change.
      //
      // Full coverage of the new behaviour, including approved and rejected
      // and the backend refusal, lives in
      // ra-358-terminal-assignment-gating.e2e.js. This case stays here so the
      // reversal is visible from the AC it reverses.
      await detail.assertNoUsableAssignmentAffordances()
    })
  })
})
