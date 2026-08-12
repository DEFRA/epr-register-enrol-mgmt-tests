import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import { createReAccreditation } from '../support/re-accreditation-journey.js'
import { raiseQuery, resumeFromQuery } from '../support/query-resubmission.js'
import { ukDateParts } from '../support/uk-time.js'

/**
 * RA-316 — duly making the SECOND entry point: an application queried
 * DURING duly-making and then resubmitted.
 *
 * Such an item sits in `updated`, carrying the tasks of the state it was
 * queried from — `submitted`. This is the path that made the CTA's scope
 * more than cosmetic: with a `submitted`-only CTA these applications would
 * have had NO route to `duly-made` at all, through the UI or otherwise,
 * because RA-316 deletes the task-driven route they previously used.
 *
 * THE GATE (management-fe, confirmed against management-be). The field is
 * `taskStateId` — the id of the state whose checklist the projected tasks
 * belong to:
 *
 *   stateId 'submitted'                             -> CTA shown
 *   stateId 'updated' AND taskStateId 'submitted'   -> CTA shown
 *   everything else                                 -> CTA absent
 *
 * So an `updated` item queried from assessment or from decision gets no
 * CTA — offering one there would let a caseworker send an application
 * backwards past assessment.
 *
 * WHY `data-state-id` AND NOT THE VISIBLE STATUS. `assessment-in-progress`
 * and `updated` BOTH display as "Updated" (RA-324), so `assertState`
 * cannot tell them apart and a spec built on the label could pass against
 * the wrong item entirely. management-fe added `data-state-id` carrying the
 * raw id for exactly this; every state assertion below uses it.
 */
describe('RA-316 duly making from the updated state', () => {
  let workItemId

  before(async () => {
    await login.login()
    workItemId = await createReAccreditation(
      'Duly Making From Updated Ltd',
      'SW1A 5DU',
      // £3,604.00. NOT a typo for £3,965 and NOT a bare band — it is a
      // COMPOSED fee, £3,276 plus one overseas reprocessing site at £328,
      // which is a legitimate real-world total. Leave it alone.
      { chargeAmountPence: 360400 }
    )
    // Query while the item is still pre-duly-made, so the query's origin —
    // and therefore the tasks it carries back — is `submitted`.
    await raiseQuery(workItemId, {
      reason: 'Please resend the business plan before we duly make this.'
    })
    // The operator answers. There is no case-management affordance for this
    // by design (a caseworker cannot resubmit on the operator's behalf), so
    // it goes through the backend directly.
    await resumeFromQuery(workItemId)
    await login.logout()
  })

  describe('the CTA survives the query round trip', () => {
    before(async () => {
      await login.login()
      await workItems.openWorkItem(workItemId)
    })

    after(async () => {
      await login.logout()
    })

    it('lands in updated, not assessment-in-progress', async () => {
      // The assertion the visible label cannot make. Both render "Updated".
      await detail.assertStateId('updated')
    })

    it('offers the "Duly make" CTA', async () => {
      // The whole reason this path is in scope: without the CTA here the
      // application is stranded.
      expect(await detail.hasDulyMakeCta()).toBe(true)
    })

    it('suppresses the tasks panel, as it does in submitted', async () => {
      // The panel is suppressed wherever duly making is the next action, not
      // by state literal. This item carries `submitted`'s tasks, which are
      // now empty — so an un-suppressed panel would render a dead end
      // ("No tasks are required...", plus a link to an empty page) right
      // beside the CTA that is the real next step.
      expect(await detail.hasTasksPanel()).toBe(false)
      expect(await detail.hasTasksLink()).toBe(false)
    })
  })

  describe('completing duly making from updated', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('reaches the same duly-making page', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.clickDulyMake()
      await dulyMaking.waitForDulyMakingUrl(workItemId)
      await dulyMaking.assertOnPage()
      // Same page, same hooks, same copy as the submitted entry point —
      // nothing about it differs by entry path.
      expect((await dulyMaking.submitButtonText()).trim()).toBe(
        'Complete duly making'
      )
    })

    it('rejects a future payment date here too', async () => {
      await dulyMaking.setPaymentDate(ukDateParts(new Date(), 1))
      await dulyMaking.submit()
      await dulyMaking.assertErrorSummary(
        'Payment date must be today or in the past'
      )
    })

    it('lands directly in duly-made, with no observable intermediate state', async () => {
      await dulyMaking.setPaymentDate(ukDateParts(new Date()))
      await dulyMaking.submit()
      await dulyMaking.waitForDetailUrl(workItemId)

      // management-be discharges the waypoint and duly-makes in ONE write,
      // so there is no observable `submitted` in between. Asserted on the
      // raw id rather than the label because "Duly made" is unambiguous but
      // the state we are proving we did NOT stop at is not.
      await detail.assertStateId('duly-made')
      await detail.assertState('Duly made')
    })

    it('withdraws the CTA and brings back no tasks panel', async () => {
      await workItems.openWorkItem(workItemId)
      expect(await detail.hasDulyMakeCta()).toBe(false)
      // RA-410 removed Tasks outright. This assertion used to read `true` —
      // `duly-made` declared `confirm-registration-fee-paid` and the panel
      // came back once duly making was no longer the next action. There is
      // now no state in which it returns, so the flip is the point: kept
      // rather than deleted so a partial revert that restored the panel in
      // `duly-made` specifically is caught here.
      expect(await detail.hasTasksPanel()).toBe(false)
    })

    it('records the two-step path in the audit history', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      // The single write is still TWO declared transitions in the history —
      // the waypoint is discharged through its declared edge rather than
      // jumped across. The audit log is the only place that is visible.
      const transitions = await detail.appliedTransitions()
      expect(transitions).toContain('updated → submitted')
      expect(transitions).toContain('submitted → duly-made')
    })
  })
})
