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
  daysAgoDeadline,
  earlierFutureDeadline,
  earlierFutureDeadlineDate,
  farFutureDeadline,
  farFutureDeadlineDate,
  todayDeadline,
  todayDeadlineDate,
  yesterdayDeadline
} from '../support/sla-extend-date.js'

/**
 * RA-611 — the determination deadline may not be set earlier than today.
 *
 *   Given the regulator wants to change the determination deadline
 *   When the regulator enters a deadline date earlier than the current date
 *   Then an appropriate error should be shown
 *
 * Reported 25-Sep-2026: a caseworker used "Change determination deadline" and
 * set the deadline to 11-Sep-2026, fourteen days in the past. It was accepted
 * and "Determination deadline changed" flashed.
 *
 * RA-611 IS NOT A REVERT OF RA-601, and the distinction is the whole reason
 * this file exists alongside ra-601-earlier-deadline.e2e.js. RA-601 removed an
 * extension-only bound: the new deadline no longer had to be after the CURRENT
 * deadline. That was correct and stays. It also removed, as a side effect of
 * removing every bound, any floor at today — which is the bug. So the rule
 * RA-611 lands is about where the target date sits, not which direction it
 * moved: earlier than the current deadline is fine, earlier than today is not.
 *
 * The boundary is `< today`, not `<= today`. Today is not "earlier than the
 * current date", so it is accepted, and the today case below is what stops the
 * fix being written one day too strict — an off-by-one that would reject a
 * regulator determining a case the same day, which is a perfectly ordinary
 * thing to do.
 *
 * WHY THE HAPPY PATH IS IN HERE TOO. A guard that over-blocks fixes the bug
 * report and breaks the feature, and that failure would not show up in the
 * negative cases at all — they pass MORE readily the more the guard rejects.
 * The future-date case and the today case are the two that can only pass if
 * the guard is exactly right.
 *
 * Dates come from test/support/sla-extend-date.js, which derives today and
 * yesterday in EUROPE/LONDON, because that is the zone management-fe resolves
 * the floor in — confirmed with the author of the guard, and deliberately NOT
 * the UTC boundary the same form's other checks use. See that file and
 * `ukDateParts` in test/support/uk-time.js for why picking the wrong one of the
 * two would flake for an hour a day through BST rather than failing outright.
 */

/**
 * The rejection copy, confirmed with management-fe rather than assumed, and
 * held in one constant because the AC requires the SAME sentence in the error
 * summary and against the field — two literals could drift apart and half the
 * requirement would stop being tested.
 */
const PAST_DEADLINE_ERROR =
  'The new determination deadline cannot be earlier than today'

/** The bound RA-601 removed. It must not return as a side effect of RA-611. */
const REMOVED_EXTENSION_ONLY_ERROR = 'must be after the current deadline'

describe('RA-611 The determination deadline cannot be set before today', () => {
  let workItemId

  // Derived from the same helpers the form is filled from, never hard-coded.
  const pinnedDeadline = farFutureDeadlineDate()
  const todaysDate = todayDeadlineDate()
  const earlierDeadline = earlierFutureDeadlineDate()

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'RA-611 Past Deadline Ltd',
        siteAddressLine1: '1 Hindsight Way',
        siteAddressTown: 'Bristol',
        siteAddressPostcode: 'BS1 1AA',
        material: 'plastic',
        tonnageBand: '0-500'
      })
    ).id

    // Submitted -> Duly made -> Assessment in progress. Payment-received
    // stamps the SLA clock; assessment-in-progress is the only state offering
    // the change-deadline action.
    await dulyMake(workItemId)
    await startAssessment(workItemId)

    // Pin the deadline two years out, for two reasons. It makes every past
    // date below unambiguously a past-date violation rather than possibly a
    // no-op resubmission of the current deadline, and it gives the negative
    // cases a known value to prove did NOT change. Left to management-be's
    // default target duration this spec would be silently coupled to it.
    await slaExtend.changeDeadline(workItemId, {
      reason: 'Pin the starting determination deadline for RA-611',
      date: farFutureDeadline()
    })
    await detail.assertCaseHeaderDueOn(pinnedDeadline)

    await login.logout()
  })

  after(async () => {
    await login.logout()
  })

  /**
   * The rejection cases run first and share one work item. Each one asserts
   * the deadline is still the pinned value afterwards, so they are free to run
   * in any order among themselves — a rejected submit changes nothing by
   * definition, and that is precisely what they check.
   */
  describe('a regulator enters a deadline earlier than today', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('rejects yesterday, the smallest possible violation (RA-611)', async () => {
      // One day back is what separates a correct `< today` guard from one that
      // is only approximately right — a guard comparing, say, whole weeks or
      // reduced to the wrong zone would let this through while still
      // rejecting the fourteen-day case below, and the bug report would look
      // fixed.
      await slaExtend.expectDeadlineRejected(workItemId, {
        reason: 'Attempting to backdate the determination deadline by a day',
        date: yesterdayDeadline(),
        message: PAST_DEADLINE_ERROR
      })
    })

    it('rejects the reported case of fourteen days in the past (RA-611)', async () => {
      // The bug exactly as reported on 25-Sep-2026 (a deadline set to
      // 11-Sep-2026), expressed as an offset so it does not rot into a date
      // that is no longer in the past.
      await slaExtend.expectDeadlineRejected(workItemId, {
        reason: 'Backdating the determination deadline by a fortnight',
        date: daysAgoDeadline(14),
        message: PAST_DEADLINE_ERROR
      })
    })

    it('rejects a date from before the SLA clock started (RA-611)', async () => {
      // A year back. RA-601 made this VALID and the product owner accepted it
      // at the time; RA-611 reverses that specific consequence, so the case is
      // kept and inverted rather than deleted — an inverted assertion records
      // the decision changing, where a deletion would leave no trace that it
      // was ever deliberate.
      await slaExtend.expectDeadlineRejected(workItemId, {
        reason: 'Backdating the determination deadline by a year',
        date: beforeClockStartDeadline(),
        message: PAST_DEADLINE_ERROR
      })
    })

    it('re-renders the rejected form with the answers still in it (RA-611)', async () => {
      // The GOV.UK error pattern: a rejected form comes back populated so the
      // caseworker fixes the one wrong field instead of retyping the reason.
      // Asserted separately from the message because a validator added without
      // threading the submitted values back through renders the error
      // correctly and still empties the form.
      const reason = 'Preserved reason text for RA-611'
      const date = yesterdayDeadline()

      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({ reason, date })
      await slaExtend.submitForm()
      await slaExtend.assertDeadlineError(PAST_DEADLINE_ERROR)

      expect(await slaExtend.submittedValues()).toEqual({
        reason,
        day: String(date.day),
        month: String(date.month),
        year: String(date.year)
      })
    })

    it('does not apply the change, and says so with the right guard (RA-611)', async () => {
      // AC2's second half, and the part that actually proves the bug fixed
      // rather than merely re-decorated. The reported defect was not a missing
      // message: it was that the deadline MOVED. A build that rendered the
      // error and saved anyway would satisfy every assertion above.
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'This submission must change nothing',
        date: yesterdayDeadline()
      })
      await slaExtend.submitForm()
      await slaExtend.assertDeadlineError(PAST_DEADLINE_ERROR)

      // Pinned by TEXT, not merely by an error summary existing: the no-op
      // guard also renders a summary here, and RA-601's removed
      // extension-only bound would too. An assertion that could not tell them
      // apart would pass against a build that had reinstated the wrong rule.
      expect(await slaExtend.errorSummaryText()).not.toContain(
        REMOVED_EXTENSION_ONLY_ERROR
      )
      // GOV.UK requires the summary link to focus the offending field; for a
      // three-box date input that is the day box.
      expect(await slaExtend.errorSummaryLinkHref()).toBe('#new-deadline-day')

      // Now the state. Navigating afresh rather than trusting the re-rendered
      // form: the deadline lives on the work item, and the form's own boxes
      // echo back what was typed, which proves nothing about what was stored.
      await workItems.openWorkItem(workItemId)
      // No success banner. The flash is consumed on read, so had the rejected
      // submit flashed one, this first detail-page load is where it surfaces.
      await detail.assertNoFlashBanner()
      await detail.assertCaseHeaderDueOn(pinnedDeadline)
    })
  })

  /**
   * The cases that can only pass if the guard is exactly right. These DO
   * change the deadline, so they run after the rejection cases — which assert
   * against the pinned value — and in this order, each moving to a date
   * distinct from the one the previous left behind so none is a no-op.
   */
  describe('a regulator enters today or a future date', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('accepts today, which is not earlier than today (RA-611 boundary)', async () => {
      // THE OFF-BY-ONE CASE. Today is not "earlier than the current date", so
      // the floor is exclusive. This is also a reduction from the pinned
      // two-year deadline, so passing it means RA-601 survived RA-611: the
      // deadline still moves backwards, just not past today.
      //
      // The header is read from a freshly-opened detail page: the previous
      // block logged out and the rejection cases ended on the FORM, so there is
      // no case header on screen at this point to read "Due on" from.
      await workItems.openWorkItem(workItemId)
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.changeDeadline(workItemId, {
        reason: 'Determining this case today',
        date: todayDeadline()
      })

      await detail.assertFlashBanner()
      await detail.waitForDueOnToChangeFrom(before)
      await detail.assertCaseHeaderDueOn(todaysDate)
    })

    it('still accepts an ordinary future date (RA-611 must not over-block)', async () => {
      // A year out, from a deadline now sitting on today: forwards this time.
      // Re-pinning far out first would make the move backwards; either
      // direction is valid and the point here is only that an ordinary future
      // date is unaffected by the new guard.
      await slaExtend.changeDeadline(workItemId, {
        reason: 'Operator providing additional evidence',
        date: earlierFutureDeadline()
      })

      await detail.assertFlashBanner()
      await detail.assertCaseHeaderDueOn(earlierDeadline)
    })

    it('shows the "Determination deadline changed" success banner (RA-611 AC3)', async () => {
      // Pinned byte-for-byte here, unlike ra-131 which asserts only that the
      // stale "SLA"/"extend" vocabulary is gone. The AC names this banner as
      // the evidence the change applied, and it is the banner the bug report
      // saw on a submission that should have been refused — so which banner
      // appears, and on which submissions, is the behaviour under test.
      await slaExtend.changeDeadline(workItemId, {
        reason: 'Restoring the determination deadline',
        date: farFutureDeadline()
      })

      await detail.assertFlashBanner()
      expect(await detail.flashBannerText()).toContain(
        'Determination deadline changed'
      )
      await detail.assertCaseHeaderDueOn(pinnedDeadline)
    })
  })
})
