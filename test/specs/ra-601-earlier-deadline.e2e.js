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
  beforeClockStartDeadline,
  dulyMadeAnchorDeadline,
  earlierFutureDeadlineDate,
  earlierFutureDeadline,
  farFutureDeadline,
  farFutureDeadlineDate,
  todayDeadline,
  todayDeadlineDate
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
 * THE DECISION, so the assertions below are not mistaken for accidents.
 * RA-601 removed the bound on DIRECTION: moving the deadline earlier than the
 * current deadline is valid, and that has not changed. At the time it also
 * removed the floor entirely, so a date before today and before the SLA
 * clock's `startedAt` were valid too, the product owner having accepted the
 * latter explicitly.
 *
 * RA-611 WITHDREW THAT SECOND HALF and this file has been updated in place to
 * match, rather than left asserting the superseded behaviour. A caseworker
 * backdated a live case by fourteen days and it saved, so a FLOOR is back — but
 * not at today. RA-611's first revision did floor the deadline at today, and
 * this file briefly asserted that; Anthony Moody corrected the spec on
 * 29-Sep-2026 and the floor is now
 *
 *   the LATER of the SLA clock's start date (the duly-made date) and 1 January
 *   of the accreditation year,
 *
 * strictly below, so the floor itself is accepted. BACKDATING IS THEREFORE
 * LEGAL, which matters to this file: the reason a date a year back is still
 * refused below is that it predates this fixture's clock, NOT that it is in the
 * past. The direction bound is still gone. Keeping both rules in one file, with
 * the rejection asserted by its TEXT, is what stops a future reader — or a
 * future regression — collapsing them into "RA-611 reverted RA-601", which it
 * did not. The ra-611 spec owns that journey in full, on a fixture duly made
 * sixty days back so it has a past to reach into; this file keeps the RA-601
 * half honest and records where the two meet.
 *
 * The form therefore has three rejections: the two floor bounds, and the no-op —
 * resubmitting the current deadline unchanged, which is not a change and is
 * told so.
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
  const todaysDate = todayDeadlineDate()

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

    it('now REJECTS a deadline below the duly-made date (RA-611 narrows this half)', async () => {
      // THIS CASE USED TO ASSERT THE OPPOSITE, and the inversion is the record
      // of a decision changing rather than a mistake being corrected. RA-601
      // removed every bound on this date, and the product owner explicitly
      // accepted the consequence that a deadline could be backdated to before
      // the SLA clock started. RA-611 withdrew THAT specific consequence, and
      // its final shape says why the product owner's acceptance was reasonable
      // but too broad: the deadline may be backdated as far as the DULY-MADE
      // date — the first date the regulator had everything needed to determine
      // the application — and no further. Before the clock started is exactly
      // what that excludes.
      //
      // (RA-611's first revision floored the deadline at TODAY and this case
      // asserted that wording. The spec was corrected on 29-Sep-2026: backdating
      // above the floor is legal, so a past date is no longer refused for being
      // past. The date submitted here is refused for being below the anchor,
      // which is a different rule reaching the same verdict on this one date —
      // hence asserting the MESSAGE, not just that something failed.)
      //
      // RA-601 IS NOT REVERTED, which is the reason this case stays in this
      // file instead of moving wholesale into the ra-611 spec. The rule RA-601
      // removed was about DIRECTION — the new deadline had to be after the
      // current one — and it is still gone, as the first case in this block
      // proves. The rule RA-611 added is about POSITION.
      //
      // `dulyMadeAnchorDeadline(0)` because this fixture is duly made during the
      // run with no `dayOffset`, so its anchor is today's date. Spelled out
      // rather than reached for via a "today" helper, which would read as though
      // the rule were about today; it is about the clock, and this item's clock
      // merely started today.
      await slaExtend.expectRejectedBelowDulyMade(workItemId, {
        reason: 'Backdating the determination deadline (rejected since RA-611)',
        date: beforeClockStartDeadline(),
        dulyMadeOn: dulyMadeAnchorDeadline(0)
      })
      // The bound RA-601 removed must not be what fired. Also asserted inside
      // `assertDeadlineError` for every rejection on this form; kept here too
      // because it is the specific regression THIS file exists to guard.
      expect(await slaExtend.errorSummaryText()).not.toContain(
        'must be after the current deadline'
      )
    })

    it("still reduces the deadline all the way to this item's floor (RA-601 at its RA-611 limit)", async () => {
      // How far RA-601 reaches now that RA-611 has put a floor under it: the
      // deadline can still be pulled backwards by years, right down to the
      // floor, which is INCLUSIVE — the rule is strictly-below, so the floor
      // itself is accepted. For this fixture the floor is today, because it was
      // duly made during the run; that is a property of the fixture and not of
      // the rule, and the ra-611 spec exercises the same boundary sixty days
      // back.
      //
      // This replaces the case that used to pin what a PAST deadline renders as
      // in the header, and the question it raised is still open rather than
      // moot — RA-611's final shape puts past deadlines BACK within reach, so
      // whether a work item whose deadline now sits behind it should read as
      // breached can once again arise from a regulator's own change. Not
      // asserted either way here, deliberately: `breached` is a persisted flag
      // flipped by management-be's nightly SlaBreachBackgroundService, so an
      // assertion on it would be asserting on a job's schedule. The point still
      // worth putting to the product owner is the narrow one — that the flag is
      // ONE-WAY, so a regulator who backdates by mistake and then corrects the
      // date cannot undo it. Flagged rather than encoded, since asserting it
      // would bless it.
      //
      // Opened afresh because the case above it ended on the rejected FORM, so
      // there is no case header on screen to read "Due on" from.
      await workItems.openWorkItem(workItemId)
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.changeDeadline(workItemId, {
        reason: 'Determining this case today',
        date: todayDeadline()
      })

      await detail.assertFlashBanner()
      await detail.waitForDueOnToChangeFrom(before)
      await detail.assertCaseHeaderDueOn(todaysDate)
      // Still a real date, never the em dash that means "no SLA clock".
      expect(await detail.hasRealDueOn()).toBe(true)
      // RA-295 removed the On track / At risk / Breached tag from this page and
      // RA-611 does not bring it back.
      await expect(detail.slaStatusBadge()).not.toBeExisting()
    })

    it('can move the deadline forwards again afterwards', async () => {
      // RA-601 removes a bound; it must not install the opposite one. Once
      // the deadline has been pulled all the way back to the floor, extending it
      // again has to keep working — that is the journey a regulator who
      // advanced a date too far actually needs, and since RA-611 it is the
      // ONLY remedy available for an over-reduction: the duly-made date is the
      // floor, so a
      // caseworker who reduces too far has to move forwards to recover.
      await slaExtend.changeDeadline(workItemId, {
        reason: 'Restoring the determination deadline after advancing it',
        date: farFutureDeadline()
      })

      await detail.assertFlashBanner()
      await detail.assertCaseHeaderDueOn(pinnedDeadline)
    })
  })
})
