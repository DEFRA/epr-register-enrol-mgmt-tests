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
  DULY_MADE_DAYS_AGO,
  beforeClockStartDeadline,
  daysAgoDeadline,
  deadlineDateFromParts,
  dulyMadeAnchorDeadline,
  earlierFutureDeadline,
  earlierFutureDeadlineDate,
  farFutureDeadline,
  farFutureDeadlineDate,
  justBelowFloorDeadline,
  onFloorDeadline,
  pastDeadlineAboveFloor,
  todayDeadline,
  todayDeadlineDate,
  wellBelowFloorDeadline
} from '../support/sla-extend-date.js'

/**
 * RA-611 — the determination deadline has a FLOOR, and it is not today.
 *
 *   Given the regulator wants to change the determination deadline
 *   When the regulator enters a deadline below the floor
 *   Then an appropriate error should be shown
 *
 * THE SPEC CHANGED ON 29-SEP-2026 AND THIS FILE IS THE RECORD OF IT. RA-611 was
 * first understood as "the deadline may not be earlier than today", and this
 * suite shipped specs asserting exactly that. Anthony Moody then clarified the
 * intent:
 *
 *   > the determination date could potentially be backdated as far as the
 *   > 'duly made' date (being the first date on which the regulator had all of
 *   > the data required, and the application charge paid, in order to consider
 *   > and determine the application) but it would never be backdated to before
 *   > 1 Jan of the accreditation year.
 *
 * So the today floor is REPLACED, not supplemented. Backdating into the past is
 * legal. What a deadline may not fall below is
 *
 *   floor = the LATER of (a) the SLA clock's start date — the duly-made anchor
 *                        (b) 1 January of the payload's accreditationYear
 *
 * compared as Europe/London calendar dates, STRICTLY below, so the floor itself
 * is accepted. The file was renamed from ra-611-deadline-not-before-today.e2e.js
 * because that name now describes a rule that does not exist.
 *
 * RA-611 IS STILL NOT A REVERT OF RA-601, which is why this file sits alongside
 * ra-601-earlier-deadline.e2e.js rather than replacing it. RA-601 removed a
 * bound on DIRECTION — the new deadline no longer has to be after the current
 * one — and that survives untouched. RA-611 adds a bound on POSITION. A
 * regulator may still pull a deadline backwards by years; it just cannot land
 * below the floor.
 *
 * THE CASE THAT MATTERS MOST IS THE ACCEPTANCE ONE. "Saves a past deadline that
 * clears the floor" is the single assertion the superseded revision was built to
 * refuse, so it is the one that proves this build implements the corrected rule
 * rather than the withdrawn one. Every rejection case in this file passes MORE
 * readily the more the guard rejects — a guard left at the today floor, or
 * hard-failing every past date, satisfies all of them. Only the acceptance cases
 * can tell a correct floor from an over-strict one.
 *
 * WHY THIS FIXTURE IS DULY MADE IN THE PAST, and why that took discovering. The
 * floor is derived from the SLA clock, and the clock is stamped by the
 * payment-received transition from the PAYMENT DATE THE CASEWORKER ENTERS —
 * `paymentDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc)` in
 * management-be's duly-making service — not from the moment of the transition.
 * `dulyMake`'s existing `dayOffset` therefore back-dates the anchor as well as
 * the payment date, and management-fe's payment-date validator allows 365 days
 * of it. An earlier analysis of this suite concluded no fixture could have a
 * backdated clock; that was wrong, and it matters because on an item duly made
 * TODAY the floor IS today and ACs 2-5 all collapse into the degenerate case the
 * superseded revision already covered.
 *
 * THE 1-JANUARY BOUND NEEDS A SEEDED FIXTURE, and the reason is worth reading
 * before the block at the foot of this file. For that bound to BIND it has to be
 * the later of the two, which needs a work item whose payload carries a numeric
 * `accreditationYear` AND whose duly-made anchor falls before 1 January of it.
 * Nothing this suite can create through the UI qualifies on either count: the
 * case-management create form does not collect an accreditation year (it arrives
 * on the upstream operator submission), and management-be deliberately treats an
 * absent one as "no 1-January bound" rather than defaulting to the current year.
 * So on every item created above, the duly-made anchor is the floor by itself
 * and the 1-January rule is inert whatever date is submitted — which is also
 * true of production for any item that reaches case management without a year.
 *
 * management-be therefore seeds one fixture for it, and the final describe block
 * is the only place in this suite where that bound is exercised.
 */

describe('RA-611 The determination deadline floor: duly made, not today', () => {
  let workItemId

  // Every date is derived from the same helpers the form is filled from, never
  // hard-coded: an absolute date goes stale, and an expectation computed a
  // different way from the input is an expectation free to drift away from it.
  const pinnedDeadline = farFutureDeadlineDate()
  const todaysDate = todayDeadlineDate()
  const earlierDeadline = earlierFutureDeadlineDate()

  // The fixture's floor, in the day/month/year form the error message renders.
  // Read off the SAME helper that produced the payment date, so the expected
  // message and the fixture cannot disagree about where the anchor is.
  const dulyMadeOn = dulyMadeAnchorDeadline()

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'RA-611 Deadline Floor Ltd',
        siteAddressLine1: '1 Hindsight Way',
        siteAddressTown: 'Bristol',
        siteAddressPostcode: 'BS1 1AA',
        material: 'plastic',
        tonnageBand: '0-500'
      })
    ).id

    // Submitted -> Duly made -> Assessment in progress.
    //
    // THE `dayOffset` IS THE WHOLE FIXTURE. It back-dates the payment date, and
    // therefore the SLA clock, and therefore the floor — without it the floor
    // is today and not one of the cases below can distinguish the corrected
    // rule from the withdrawn one. `DULY_MADE_DAYS_AGO` documents why 60.
    //
    // assessment-in-progress is the only state offering the change-deadline
    // action.
    await dulyMake(workItemId, { dayOffset: -DULY_MADE_DAYS_AGO })
    await startAssessment(workItemId)

    // Pin the deadline two years out, for two reasons. It makes every date
    // below unambiguously either a floor violation or a real change, rather
    // than possibly a no-op resubmission of the current deadline, and it gives
    // the rejection cases a known value to prove did NOT move. Left to
    // management-be's default target duration this spec would be silently
    // coupled to it.
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
   * The acceptance cases run FIRST, ahead of the rejections, which inverts the
   * ordering the superseded revision used. Two reasons, and they are the reason
   * this block is not simply appended at the end:
   *
   *   - These are the cases that can fail against a build still carrying the
   *     today floor. Running them first means a wrong build fails on the
   *     assertion that actually describes the corrected rule, rather than
   *     passing four rejection cases and then failing on something that reads
   *     like an unrelated flake.
   *   - Each one asserts the deadline MOVED to a specific date, so they need a
   *     known starting value, which `before()` has just pinned.
   *
   * They each move to a date distinct from the one the previous left behind, so
   * none is a no-op resubmission, and the block ends by re-pinning the deadline
   * far out for the rejection cases that follow.
   */
  describe('a regulator enters a past deadline that clears the floor', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('SAVES a deadline in the past that is above the floor (RA-611 AC2)', async () => {
      // THE CASE THE PREVIOUS COMMIT WAS BUILT TO REJECT. Thirty days back:
      // unambiguously in the past, unambiguously above the sixty-day anchor,
      // and far from both bounds, so a guard that is merely approximately right
      // in either direction still fails it.
      //
      // This is also a reduction from the pinned two-year deadline, so passing
      // it means RA-601 survived RA-611 as well: the deadline still moves
      // backwards, now by two years and into the past.
      const date = pastDeadlineAboveFloor()

      await workItems.openWorkItem(workItemId)
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.changeDeadline(workItemId, {
        reason: 'Backdating the determination deadline to when it was decided',
        date
      })

      // AC2 names the success banner as the evidence, and pins its wording: it
      // is the same banner the original bug report saw on a submission that
      // SHOULD have been refused, so which banner appears and on which
      // submissions is the behaviour under test.
      await detail.assertFlashBanner()
      expect(await detail.flashBannerText()).toContain(
        'Determination deadline changed'
      )

      // And the state, not merely the banner. A build that flashed success and
      // discarded the change would satisfy every assertion above it.
      await detail.waitForDueOnToChangeFrom(before)
      await detail.assertCaseHeaderDueOn(deadlineDateFromParts(date))
    })

    it('accepts a deadline exactly ON the floor (RA-611 AC5 boundary)', async () => {
      // THE OFF-BY-ONE CASE. The rule is STRICTLY below the floor, so the
      // duly-made date itself passes. An inclusive comparison would refuse a
      // regulator backdating to the very date the application became
      // determinable — the most defensible backdate there is, and precisely the
      // one Anthony Moody's clarification was written to permit.
      //
      // It fails silently in the other direction too: a guard one day too
      // LENIENT still rejects everything the cases below submit, so this is the
      // only case in the file that pins the boundary exactly.
      const date = onFloorDeadline()

      await workItems.openWorkItem(workItemId)
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.changeDeadline(workItemId, {
        reason: 'Backdating to the date the application was duly made',
        date
      })

      await detail.assertFlashBanner()
      await detail.waitForDueOnToChangeFrom(before)
      await detail.assertCaseHeaderDueOn(deadlineDateFromParts(date))
    })

    it('no longer rejects yesterday, as the withdrawn today floor did', async () => {
      // THE RETIRED RULE, ASSERTED GONE. Yesterday was the superseded
      // revision's tightest REJECTION case — the one that separated a correct
      // `< today` guard from an approximate one. Under the corrected rule it is
      // an ordinary date comfortably above a sixty-day-old floor and must save.
      //
      // Inverted in place rather than deleted: an inverted assertion records a
      // decision changing, where a deletion leaves no trace that the old
      // behaviour was ever deliberate, and no guard that it has not crept back.
      await workItems.openWorkItem(workItemId)
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.changeDeadline(workItemId, {
        reason: 'Determining this case as of yesterday',
        date: daysAgoDeadline(1)
      })

      await detail.assertFlashBanner()
      await detail.waitForDueOnToChangeFrom(before)
    })

    it('still accepts today, and an ordinary future date (RA-611 must not over-block)', async () => {
      // The other half of "must not over-block". A floor is a floor: today and
      // the future are unaffected by it, and a guard that reached them would be
      // refusing the ordinary case while the bug report's case sailed through.
      await slaExtend.changeDeadline(workItemId, {
        reason: 'Determining this case today',
        date: todayDeadline()
      })
      await detail.assertFlashBanner()
      await detail.assertCaseHeaderDueOn(todaysDate)

      await slaExtend.changeDeadline(workItemId, {
        reason: 'Operator providing additional evidence',
        date: earlierFutureDeadline()
      })
      await detail.assertFlashBanner()
      await detail.assertCaseHeaderDueOn(earlierDeadline)

      // Re-pin far out for the rejection cases below, which assert against a
      // known value. Done here, inside the block that moved it, rather than in
      // a `before` of the next block — the deadline is this block's to leave
      // tidy.
      await slaExtend.changeDeadline(workItemId, {
        reason: 'Restoring the determination deadline',
        date: farFutureDeadline()
      })
      await detail.assertFlashBanner()
      await detail.assertCaseHeaderDueOn(pinnedDeadline)
    })
  })

  /**
   * The rejection cases share one work item and all assert the deadline is
   * still the pinned value afterwards, so they are free to run in any order
   * among themselves — a rejected submit changes nothing by definition, and
   * that is precisely what they check.
   *
   * Every one of them goes through `expectRejectedBelowDulyMade`, which builds
   * the expected message from `dulyMadeOn` and requires the DULY-MADE clause.
   * That is what stops them passing against a build whose `max()` of the two
   * bounds is backwards, or one that refuses every past date for some blunter
   * reason: both would produce an error summary, and an assertion that only
   * checked one appeared could not tell them apart.
   */
  describe('a regulator enters a deadline below the duly-made anchor', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('rejects one day below the floor, naming the duly-made date (RA-611 AC3)', async () => {
      // One day is the smallest violation there is, so this separates a correct
      // strictly-below guard from one off by a day in either direction. A floor
      // mistakenly placed at `anchor - 1` would still reject the cases below
      // and the bug would look fixed.
      await slaExtend.expectRejectedBelowDulyMade(workItemId, {
        reason: 'Backdating one day past the duly-made date',
        date: justBelowFloorDeadline(),
        dulyMadeOn
      })
    })

    it('rejects a month below the floor (RA-611 AC3)', async () => {
      // Not resting the rejection on a single day's arithmetic: a month under
      // the anchor is still comfortably inside management-fe's own 365-day
      // payment-date window, so nothing else can be refusing it.
      await slaExtend.expectRejectedBelowDulyMade(workItemId, {
        reason: 'Backdating a month past the duly-made date',
        date: wellBelowFloorDeadline(),
        dulyMadeOn
      })
    })

    it('rejects a date from a year before the SLA clock started (RA-611 AC3)', async () => {
      // A year back. This case has now been on both sides of the line twice —
      // CM6 refused it via the extension-only bound, RA-601 made it valid with
      // the product owner's explicit agreement, the first RA-611 revision
      // refused it again as a past date, and the corrected rule refuses it for
      // the reason that was meant all along: it predates the duly-made date.
      // Kept and re-pointed rather than deleted, because the date it submits has
      // never changed and only the reason it is refused has.
      await slaExtend.expectRejectedBelowDulyMade(workItemId, {
        reason: 'Backdating the determination deadline by a year',
        date: beforeClockStartDeadline(),
        dulyMadeOn
      })
    })

    it('re-renders the rejected form with the answers still in it (RA-611)', async () => {
      // The GOV.UK error pattern: a rejected form comes back populated so the
      // caseworker fixes the one wrong field instead of retyping the reason.
      // Asserted separately from the message because a validator added without
      // threading the submitted values back through renders the error correctly
      // and still empties the form.
      const reason = 'Preserved reason text for RA-611'
      const date = justBelowFloorDeadline()

      // Driven through the same helper as every other rejection case, so this
      // one cannot quietly pass against a DIFFERENT rejection than the floor —
      // an incomplete-date or no-op error would also re-render a populated
      // form, and asserting only "some error appeared" would call that a pass.
      await slaExtend.expectRejectedBelowDulyMade(workItemId, {
        reason,
        date,
        dulyMadeOn
      })

      // Read while still on the re-rendered form: `expectRejectedBelowDulyMade`
      // leaves the browser there, since a rejected submit never redirects.
      expect(await slaExtend.submittedValues()).toEqual({
        reason,
        day: String(date.day),
        month: String(date.month),
        year: String(date.year)
      })
    })

    it('does not apply the change, and says so with the right guard (RA-611)', async () => {
      // THE PART THAT PROVES THE RULE ENFORCED RATHER THAN MERELY ANNOUNCED.
      // The original defect was not a missing message: it was that the deadline
      // MOVED. A build that rendered the error and saved anyway would satisfy
      // every assertion above this one.
      await slaExtend.expectRejectedBelowDulyMade(workItemId, {
        reason: 'This submission must change nothing',
        date: justBelowFloorDeadline(),
        dulyMadeOn
      })

      // GOV.UK requires the summary link to focus the offending field; for a
      // three-box date input that is the day box, never the reason textarea.
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
   * RA-611 (AC4) — the 1-JANUARY BOUND, the only place in this suite it binds.
   *
   * WHY THIS BLOCK USES A SEEDED FIXTURE AND HARD-CODED DATES, when every other
   * date in this file is computed. Both are deliberate and they are the same
   * decision.
   *
   * management-be seeds `RA-611 Pre Year Start Ltd` specifically for this bound,
   * with `accreditationYear: 2026` and its SLA clock pinned to the ABSOLUTE
   * instant `2025-11-14T00:00:00Z` — not derived from the run date, unlike every
   * other seeded item's `submittedAt.AddDays(1)`. So:
   *
   *   duly-made anchor = 14 November 2025
   *   1 January of the accreditation year = 1 January 2026   <- the LATER bound
   *   floor = 1 January 2026
   *
   * Both dates are FIXED, so computing them from the run date would be strictly
   * worse than writing them down: the arithmetic would be pretending to a
   * generality the fixture does not have, and would silently produce the wrong
   * expectation the moment the seed changed.
   *
   * MIDNIGHT UTC MATTERS HERE and was asked for rather than assumed. The floor
   * compares Europe/London calendar dates, so a seeded clock carrying a
   * time-of-day would sit on one date in UTC and the next in London for one hour
   * a day through BST, and the error message would name a date this spec did not
   * predict. Pinned to midnight UTC, the London and UTC dates always coincide.
   *
   * THIS FIXTURE IS 2026-SPECIFIC AND WILL NEED RE-POINTING. Its accreditation
   * year and its clock are pinned as a coherent PAIR — the clock has to stay
   * below 1 January of the year for the year bound to remain the later one — so
   * when the live accreditation year moves on, both move together, in the seeder
   * and here. management-be has a unit test asserting
   * `StartedAt < 1 January of the payload's accreditationYear` so this cannot rot
   * silently into a fixture that quietly exercises the duly-made bound instead.
   */
  describe('the accreditation year is the later bound', () => {
    /** Fixed by the seeder; see the block comment. */
    const ACCREDITATION_YEAR = 2026
    const betweenAnchorAndYearStart = { day: 28, month: 12, year: 2025 }
    const onYearStart = { day: 1, month: 1, year: ACCREDITATION_YEAR }
    const belowTheAnchorToo = { day: 1, month: 11, year: 2025 }

    let seededWorkItemId

    before(async () => {
      await login.login()
      // Found by organisation name rather than by the seeder's deterministic id:
      // the name is a published constant that management-be unit-tests for
      // uniqueness across the seed set, so exactly one row comes back, whereas a
      // deterministic id would couple this spec to the id derivation.
      //
      // Through `findSeededWorkItemIdByOrgName` rather than a bare search, which
      // is a correction rather than a preference. Searching without resetting
      // the default filters first leaves the query implicitly scoped to the
      // logged-in assignee, and this fixture is not assigned to the stub user —
      // so the row exists and never appears, and the failure reads as "the
      // fixture is not seeded". See that helper for the full trap.
      seededWorkItemId = await workItems.findSeededWorkItemIdByOrgName(
        'RA-611 Pre Year Start Ltd'
      )
    })

    after(async () => {
      await login.logout()
    })

    it('rejects a date between the anchor and 1 January, naming 1 January (RA-611 AC4)', async () => {
      // 28 December 2025: ABOVE the duly-made anchor of 14 November 2025 and
      // BELOW 1 January 2026. That gap is the only place the two bounds
      // disagree, so it is the only date that can prove the later one wins — a
      // build taking the EARLIER of the two would accept this outright, and one
      // that ignored the year bound entirely would accept it as well.
      await slaExtend.expectRejectedBeforeAccreditationYear(seededWorkItemId, {
        reason: 'Backdating into the previous accreditation year',
        date: betweenAnchorAndYearStart,
        year: ACCREDITATION_YEAR
      })
    })

    it('names 1 January even for a date below the anchor as well (RA-611 AC4)', async () => {
      // 1 November 2025 violates BOTH bounds. Only the binding one may be
      // reported, and the binding one is the later — so the caseworker is told
      // about 1 January, not about the duly-made date they are also behind.
      // Reporting the wrong bound here would send them to correct the date to
      // 14 November 2025, which would then be refused again for a reason they
      // had not been given.
      await slaExtend.expectRejectedBeforeAccreditationYear(seededWorkItemId, {
        reason: 'Backdating below both floors at once',
        date: belowTheAnchorToo,
        year: ACCREDITATION_YEAR
      })
    })

    it('accepts 1 January itself, the floor (RA-611 AC4/AC5 boundary)', async () => {
      // The year bound is strictly-below too, so its own boundary date passes.
      // Run last in this block because it is the only case here that changes the
      // seeded item, and it changes it to a date in the PAST — which is the
      // corrected rule in one assertion: a deadline nine months behind the run
      // date, accepted, because it clears this item's floor.
      await workItems.openWorkItem(seededWorkItemId)
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.changeDeadline(seededWorkItemId, {
        reason: 'Backdating to the start of the accreditation year',
        date: onYearStart
      })

      await detail.assertFlashBanner()
      await detail.waitForDueOnToChangeFrom(before)
      await detail.assertCaseHeaderDueOn(deadlineDateFromParts(onYearStart))
    })
  })
})
