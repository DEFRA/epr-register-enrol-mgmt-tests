import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import {
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'
import {
  beforeClockStartDeadlineDate,
  beforeClockStartDeadline,
  earlierFutureDeadlineDate,
  earlierFutureDeadline,
  farFutureDeadline,
  farFutureDeadlineDate
} from '../support/sla-extend-date.js'

/**
 * RA-601 — the determination deadline can be moved EARLIER.
 *
 *   Given a regulator, where the determination deadline is set to a
 *   particular date
 *   When the regulator wants to override and advance this date
 *   And uses "Change determination deadline" to set an earlier date
 *   Then the deadline should be set to the earlier date
 *
 * Before RA-601 this returned "The new determination deadline must be after
 * the current deadline". That lower bound arrived with RA-447 (CM6) as an
 * implementation assumption: neither CM5 nor CM6 asked for a floor, and
 * RA-447's own history shows no edit that added one. RA-572's rename from
 * "Extend" to "Change" is what made it visibly wrong — a screen that offers
 * to CHANGE a date and then refuses every change in one direction.
 *
 * THE DECISION, so the assertions below are not mistaken for accidents:
 * there is no floor at all. Earlier than the current deadline is valid,
 * earlier than today is valid, and earlier than the SLA clock's `startedAt`
 * is valid — the product owner accepted that last one explicitly. The single
 * surviving rejection is the no-op: resubmitting the current deadline
 * unchanged, which is not a change and is told so.
 *
 * The route, the form and every `sla-extend-*` testid are unchanged
 * (management-fe confirmed it touched no markup for RA-601), so this spec
 * adds no selectors — only the error-text getter needed to tell the
 * surviving rejection apart from the removed one.
 *
 * The inverted case from ra-131-sla-extend.e2e.js is the narrow regression
 * guard on the bound not returning; this file is the journey.
 */
describe('RA-601 Change the determination deadline to an earlier date', () => {
  let workItemId

  // Derived from the same helpers the form is filled from, never hard-coded:
  // an absolute date would go stale, and an expectation computed a different
  // way from the input is an expectation that can drift away from it.
  const pinnedDeadline = farFutureDeadlineDate()
  const earlierDeadline = earlierFutureDeadlineDate()
  const preClockDeadline = beforeClockStartDeadlineDate()

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'RA-601 Earlier Deadline Ltd',
        siteAddressLine1: '1 Advance Avenue',
        siteAddressTown: 'Leeds',
        siteAddressPostcode: 'LS1 1AB',
        material: 'plastic',
        tonnageBand: '0-500'
      })
    ).id

    // Submitted -> Duly made -> Assessment in progress. Payment-received is
    // the transition that stamps the SLA clock, and assessment-in-progress is
    // the state where the change-deadline action is offered.
    await dulyMake(workItemId)
    await startAssessment(workItemId)

    // Pin the starting deadline two years out so "earlier" is unambiguous.
    // Without this the starting value is management-be's default target
    // duration, which this suite would then be silently coupled to — and a
    // default of a few weeks would leave "one year out" LATER, not earlier,
    // quietly turning the headline case into an extension.
    await slaExtend.changeDeadline(workItemId, {
      reason: 'Pin the starting determination deadline for RA-601',
      date: farFutureDeadline()
    })
    await detail.assertCaseHeaderDueOn(pinnedDeadline)

    await login.logout()
  })

  after(async () => {
    await login.logout()
  })

  /**
   * These cases run in order and share one work item, because each depends on
   * the deadline the previous one left behind — the no-op case in particular
   * can only resubmit "the current deadline" if it knows what that is, and
   * knowing it by having just set it beats parsing it back out of the header.
   */
  describe('a regulator advances the deadline', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('saves a deadline earlier than the current one and shows the earlier date (RA-601)', async () => {
      // THE ASSERTION RA-601 LIVES OR DIES BY. Landing back on the detail
      // page with a banner is not enough on its own: the pre-RA-601 build
      // also returns you to a page, just with an error summary on the form
      // instead. What separates fixed from broken is the header showing the
      // EARLIER date afterwards.
      await workItems.openWorkItem(workItemId)
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.changeDeadline(workItemId, {
        reason: 'Operator responded early; regulator advancing the deadline',
        date: earlierFutureDeadline()
      })

      await detail.assertFlashBanner()
      await detail.waitForDueOnToChangeFrom(before)
      await detail.assertCaseHeaderDueOn(earlierDeadline)
    })

    it('rejects resubmitting the current deadline unchanged', async () => {
      // The only rejection RA-601 leaves on this form. Asserted by its TEXT,
      // not merely by an error summary appearing: the removed extension-only
      // bound would also render an error summary here, and an assertion that
      // cannot tell the two apart would pass against the very build this
      // ticket exists to fix.
      //
      // The date submitted is the one the previous case just applied, so this
      // is genuinely a no-op without having to parse the rendered header.
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'Resubmitting the same date',
        date: earlierFutureDeadline()
      })
      await slaExtend.submitForm()

      await slaExtend.assertErrorSummaryDisplayed()
      await slaExtend.assertOnInputPage()
      expect(await slaExtend.errorSummaryText()).toContain(
        'The new determination deadline must be different from the current deadline'
      )
      // The removed message must not come back under any circumstances.
      expect(await slaExtend.errorSummaryText()).not.toContain(
        'must be after the current deadline'
      )
    })

    it('saves a deadline from before the SLA clock started (RA-601, accepted by the PO)', async () => {
      // A year in the past, so it is earlier than `startedAt` whatever the
      // runner's zone and however long fixture setup took. management-fe adds
      // no floor of its own and no confirm step, so this validates straight
      // through on the first submit.
      await slaExtend.changeDeadline(workItemId, {
        reason: 'Backdating the determination deadline (RA-601)',
        date: beforeClockStartDeadline()
      })

      await detail.assertFlashBanner()
      await detail.assertCaseHeaderDueOn(preClockDeadline)
    })

    it('records what a past deadline renders as, rather than what it ought to', async () => {
      // WHAT THIS DOES AND DOES NOT CLAIM. Whether a work item whose deadline
      // now sits in the past should read as "Breached" is an open question
      // going back to the product owner — nobody specified it for RA-601. So
      // this pins only what is actually true of the build, deliberately:
      //
      //   - The header keeps showing the real date. The em dash is reserved
      //     for the Cancelled SLA state, which this item is not in, so a past
      //     deadline must not blank the field.
      //   - No SLA status badge reappears. RA-295 removed the "On track" /
      //     "At risk" / "Breached" govukTag from the detail page outright, so
      //     there is no breach affordance here to light up — a past deadline
      //     looks exactly like a future one apart from the date itself.
      //
      // WHY BREACH IS NOT ASSERTED AT ALL, which is the part worth reading.
      // `breached` is not derived on read: it is a persisted boolean on the
      // item's `slaClock`, flipped by management-be's SlaBreachBackgroundService
      // — a NIGHTLY sweep (SlaBreachJob:IntervalHours, default 24). So moving
      // a deadline into the past does not breach the item at save time; it
      // breaches up to a day later, whenever the sweep next runs. An e2e
      // assertion either way would be asserting on a job's schedule.
      //
      // The sweep is also ONE-WAY. It skips items already marked breached and
      // nothing anywhere resets the flag, so once the sweep has caught a
      // backdated item, restoring the deadline to the future leaves it
      // permanently breached with an `sla-breached` audit entry against it.
      // RA-601 makes backdating a supported journey, so it makes that
      // irreversible state reachable by ordinary use for the first time —
      // flagged to the product owner rather than encoded here as if intended.
      //
      // If the PO decides a past deadline SHOULD be signalled, this case is
      // the one to rewrite, and its failure is the signal that it shipped.
      await workItems.openWorkItem(workItemId)
      expect(await detail.hasRealDueOn()).toBe(true)
      await detail.assertCaseHeaderDueOn(preClockDeadline)
      await expect(detail.slaStatusBadge()).not.toBeExisting()
    })

    it('can move the deadline forwards again afterwards', async () => {
      // RA-601 removes a bound; it must not install the opposite one. Once
      // the deadline has been pulled back into the past, extending it again
      // has to keep working — that is the journey a regulator who advanced a
      // date by mistake actually needs.
      await slaExtend.changeDeadline(workItemId, {
        reason: 'Restoring the determination deadline after advancing it',
        date: farFutureDeadline()
      })

      await detail.assertFlashBanner()
      await detail.assertCaseHeaderDueOn(pinnedDeadline)
    })
  })
})
