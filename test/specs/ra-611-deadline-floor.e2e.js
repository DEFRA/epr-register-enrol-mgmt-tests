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
  belowPreYearStartAnchorDeadline,
  dayBeforeYearStartDeadline,
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
  pastDeadlineAboveYearStart,
  preYearStartAnchorDaysAgo,
  todayDeadline,
  todayDeadlineDate,
  wellBelowFloorDeadline,
  yearStartDeadline
} from '../support/sla-extend-date.js'
import { ukCalendarYear } from '../support/uk-time.js'

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
 *   > Any backdated Determination Date should not be further back than 1st Jan
 *   > of current year. Most appropriate date is to use the 'Duly Date', however,
 *   > if this is prior to the 1st January of current year, do not backdate beyond
 *   > 1st January.
 *
 * So the today floor is REPLACED, not supplemented. Backdating into the past is
 * legal. What a deadline may not fall below is
 *
 *   floor = the LATER of (a) the SLA clock's start date — the duly-made anchor
 *                        (b) 1 January of the CURRENT calendar year
 *
 * compared as Europe/London calendar dates, STRICTLY below, so the floor itself
 * is accepted. The file was renamed from ra-611-deadline-not-before-today.e2e.js
 * because that name now describes a rule that does not exist.
 *
 * ⚠ (b) WENT OUT WRONG ONCE AND QA CAUGHT IT ON 5-OCT-2026. It read 1 January of
 * the payload's `accreditationYear` — the year the accreditation is VALID FOR,
 * which is stamped at approval and is always AHEAD of determination
 * (management-be's config holds 2027). Determination happens before the
 * accreditation year begins, so live 2026 cases were floored at 1 January 2027
 * and every date in 2026 was refused, their own existing deadlines included: a
 * case due 4 December 2026 could not be set to 20 September 2026, the error
 * naming "1 January 2027". Giri confirmed on 5-Oct-2026 that the year is 2026,
 * i.e. the current one. The bound now comes from the clock.
 *
 * WHY CI STAYED GREEN THROUGH ALL OF IT, which is the part worth learning from.
 * The year bound was unreachable on anything this suite could create, so it was
 * covered by a seeded fixture with `accreditationYear: 2026` and a Nov-2025
 * clock — a year in the PAST relative to the run. That is the INVERSE of
 * production, where the accreditation year is in the future, and it is the only
 * arrangement in which the broken rule and the correct one behave the same way.
 * The coverage demonstrated the rule working in a configuration that cannot
 * occur. The block at the foot of this file is now built from the ordinary
 * journey precisely so that it is pointed at the configuration production has.
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
 * THE 1-JANUARY BOUND NO LONGER NEEDS A SEEDED FIXTURE, and that follows from
 * the correction rather than from any new helper. For the bound to BIND it has
 * to be the later of the two, which needs a work item whose duly-made anchor
 * falls before 1 January. Under the withdrawn reading it ALSO needed a payload
 * carrying a numeric `accreditationYear`, which nothing created through the
 * case-management UI has — the create form does not collect one, it arrives on
 * the upstream operator submission — so the bound was inert on every item this
 * suite could build and management-be seeded a fixture for it. The current year
 * is always resolvable, so the only remaining requirement is the anchor, and
 * back-dating the payment date arranges that through the ordinary journey.
 *
 * WHICH ALSO MEANS THE FIRST TWO BLOCKS BELOW ARE THE SAME JOURNEY WITH
 * DIFFERENT CLOCKS, and that is the point: one item duly made inside the current
 * year, so the duly-made anchor is the later bound, and one duly made before it,
 * so 1 January is. Each asserts the message of ITS OWN bound, which is what
 * distinguishes a correct `max()` from a backwards one.
 *
 * THE SEEDED FIXTURE IS STILL HERE, in the last block, but for its CLOCK rather
 * than its accreditation year. Its anchor is an absolute instant in November
 * 2025, so the year bound binds on it permanently with no arithmetic and no
 * re-pointing, which is the one thing the journey block cannot claim — the
 * journey block's anchor is derived from the run date and so can slide. Between
 * them: the production-shaped path, and a path that cannot drift.
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
   * RA-611 (AC4) — THE 1-JANUARY BOUND, at the CURRENT calendar year.
   *
   * ITS OWN WORK ITEM, BUILT BY THE ORDINARY JOURNEY, and that is the whole
   * correction. The previous revision reached for a seeded fixture carrying
   * `accreditationYear: 2026` against a Nov-2025 clock, because the bound read
   * that payload field and nothing created through the case-management UI has
   * one. It also put the accreditation year in the PAST relative to the run,
   * which is the inverse of production — the year an accreditation is valid for
   * is stamped at approval and is always ahead of determination — and is the one
   * arrangement in which the broken bound and the correct one agree. That is why
   * this block was green while QA was blocked.
   *
   * The bound now comes from the clock, so it applies to every work item, and the
   * only thing a fixture needs is a duly-made anchor BELOW 1 January. The
   * payment date sets the SLA clock, so back-dating it far enough arranges that
   * through the same two transitions every other spec in this file uses.
   *
   * THE OFFSET IS COMPUTED, NOT WRITTEN DOWN. `preYearStartAnchorDaysAgo` places
   * the anchor at the midpoint of the window between management-fe's twelve-month
   * payment-date floor and 31 December, so there is room on both sides whatever
   * the time of year. A flat offset cannot do that: -300 days clears both bounds
   * today, with 45 days to spare, and from about 28 October each year lands
   * INSIDE the current year — at which point the duly-made bound becomes the
   * later one, this block's rejections report the other message, and it fails on
   * the wording rather than the rule.
   *
   * EVERY DATE HERE IS RELATIVE TO 1 JANUARY OF THE RUN'S OWN YEAR, for the same
   * reason. "31 December 2025 is rejected" is true today and silently meaningless
   * from 1 January 2027: the floor moves on new year, and a hard-coded date drifts
   * from a boundary case into an ordinary one without ever failing.
   *
   * THE COMPLEMENT OF THIS BLOCK IS THE ONE ABOVE IT. There, the anchor sits
   * inside the current year, so the duly-made bound is the later of the two and
   * its message is the one asserted. Between them they pin the `max()` from both
   * sides; either alone would pass against a build that had it backwards.
   */
  describe('1 January of the current year is the later bound', () => {
    // Resolved in Europe/London, which is where management-fe resolves it: the
    // expected message and the service must agree about the year, and on
    // New Year's Eve the runner's own zone need not.
    const currentYear = ukCalendarYear(new Date())

    // Resolved ONCE, here, and both the payment date and the guard below are
    // derived from it. Calling the helper twice would let a run that straddles
    // midnight UTC compute the offset from one date and check it against
    // another.
    const anchorDaysAgo = preYearStartAnchorDaysAgo()
    const anchor = daysAgoDeadline(anchorDaysAgo)

    const yearStart = yearStartDeadline()
    const pinnedDeadline = farFutureDeadlineDate()

    let preYearStartWorkItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      preYearStartWorkItemId = (
        await workItems.createWorkItem({
          organisationName: 'RA-611 Pre Year Start Journey Ltd',
          siteAddressLine1: '1 New Year Lane',
          siteAddressTown: 'Bristol',
          siteAddressPostcode: 'BS1 1AA',
          material: 'plastic',
          tonnageBand: '0-500'
        })
      ).id

      // The back-dated payment date is this fixture's entire reason for
      // existing: it puts the SLA clock, and so the duly-made bound, in the
      // PREVIOUS calendar year, which is what makes 1 January the later bound.
      await dulyMake(preYearStartWorkItemId, { dayOffset: -anchorDaysAgo })
      await startAssessment(preYearStartWorkItemId)

      // Guard the fixture before asserting anything with it. If the anchor did
      // not land in the previous year the bound under test is not the one that
      // binds, and every case below would fail on the error wording — which
      // reads like a copy regression rather than a fixture that slid out of
      // position. Checked against the submitted parts rather than the rendered
      // page because this is an assertion about the FIXTURE, not the product.
      expect(Number(anchor.year)).toBe(currentYear - 1)

      await slaExtend.changeDeadline(preYearStartWorkItemId, {
        reason: 'Pin the starting determination deadline for RA-611 AC4',
        date: farFutureDeadline()
      })
      await detail.assertCaseHeaderDueOn(pinnedDeadline)
    })

    after(async () => {
      await login.logout()
    })

    it('SAVES a past deadline above both bounds (RA-611 AC2/AC4)', async () => {
      // THE CASE THE BROKEN BUILD REFUSED, and the reason it is first. The
      // withdrawn bound floored this item at 1 January of its accreditation
      // year — a year AHEAD of the run — so every date in the current year was
      // rejected, which is exactly what QA hit: deadline 4 December 2026,
      // attempted 20 September 2026, refused naming 1 January 2027.
      //
      // Halfway between 1 January and today: unambiguously in the past,
      // unambiguously above both bounds, and far from each, so a guard that is
      // merely approximately right in either direction still fails it.
      const date = pastDeadlineAboveYearStart()

      await workItems.openWorkItem(preYearStartWorkItemId)
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.changeDeadline(preYearStartWorkItemId, {
        reason: 'Backdating the determination deadline to when it was decided',
        date
      })

      await detail.assertFlashBanner()
      await detail.waitForDueOnToChangeFrom(before)
      await detail.assertCaseHeaderDueOn(deadlineDateFromParts(date))

      // Re-pin far out before leaving. Not tidiness: on a run ON 1 January this
      // date and the next test's ARE the same day, and without the re-pin the
      // second submission would be refused as a no-op resubmission and read as
      // a floor failure.
      await slaExtend.changeDeadline(preYearStartWorkItemId, {
        reason: 'Restoring the determination deadline',
        date: farFutureDeadline()
      })
      await detail.assertFlashBanner()
    })

    it('accepts 1 January itself, the floor (RA-611 AC4 boundary)', async () => {
      // THE OFF-BY-ONE CASE for this bound. The rule is STRICTLY below, so
      // 1 January passes — Anthony Moody's wording is "do not backdate beyond
      // 1st January", which includes it. An inclusive comparison would refuse
      // the single date the AC names, and would still reject everything the
      // cases below submit, so this is the only assertion that pins it.
      await workItems.openWorkItem(preYearStartWorkItemId)
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.changeDeadline(preYearStartWorkItemId, {
        reason: 'Backdating to the start of the current year',
        date: yearStart
      })

      await detail.assertFlashBanner()
      await detail.waitForDueOnToChangeFrom(before)
      await detail.assertCaseHeaderDueOn(deadlineDateFromParts(yearStart))

      // Re-pin for the rejection cases, which assert against a known value.
      await slaExtend.changeDeadline(preYearStartWorkItemId, {
        reason: 'Restoring the determination deadline',
        date: farFutureDeadline()
      })
      await detail.assertFlashBanner()
      await detail.assertCaseHeaderDueOn(pinnedDeadline)
    })

    it('rejects the day before 1 January, naming the CURRENT year (RA-611 AC4)', async () => {
      // 31 December of the previous year: ABOVE this item's duly-made anchor and
      // one day BELOW the bound. That gap is the only place the two bounds
      // disagree, so it is the only date that can prove the LATER one wins — a
      // build taking the earlier would accept it, and one ignoring the year
      // bound would accept it too.
      //
      // The year in the message is the assertion. The broken build produced the
      // identical sentence with the year after this one, so "an error naming
      // 1 January appeared" would have passed against it;
      // `expectRejectedBeforeYearStart` requires the current year and refuses
      // the next.
      await slaExtend.expectRejectedBeforeYearStart(preYearStartWorkItemId, {
        reason: 'Backdating into the previous calendar year',
        date: dayBeforeYearStartDeadline(),
        year: currentYear
      })
    })

    it('names 1 January even for a date below the anchor as well (RA-611 AC4)', async () => {
      // A month under the anchor, so BOTH bounds are violated. Only the binding
      // one may be reported, and the binding one is the later — so the
      // caseworker is told about 1 January, not about the duly-made date they
      // are also behind. Reporting the wrong bound here would send them to
      // correct the date to the anchor, which would then be refused again for a
      // reason they had never been given.
      await slaExtend.expectRejectedBeforeYearStart(preYearStartWorkItemId, {
        reason: 'Backdating below both floors at once',
        date: belowPreYearStartAnchorDeadline(),
        year: currentYear
      })
    })

    it('does not apply the rejected change (RA-611 AC4)', async () => {
      // The original defect was not a missing message: it was that the deadline
      // MOVED. A build that rendered the error and saved anyway would satisfy
      // every assertion above this one.
      await slaExtend.expectRejectedBeforeYearStart(preYearStartWorkItemId, {
        reason: 'This submission must change nothing',
        date: dayBeforeYearStartDeadline(),
        year: currentYear
      })

      expect(await slaExtend.errorSummaryLinkHref()).toBe('#new-deadline-day')

      // Navigating afresh rather than trusting the re-rendered form: the
      // deadline lives on the work item, and the form's boxes echo back what was
      // typed, which proves nothing about what was stored.
      await workItems.openWorkItem(preYearStartWorkItemId)
      await detail.assertNoFlashBanner()
      await detail.assertCaseHeaderDueOn(pinnedDeadline)
    })
  })

  /**
   * RA-611 (AC4) — THE SAME BOUND, ON AN ABSOLUTE CLOCK.
   *
   * The block above proves the bound through the journey production uses, which
   * is what the previous revision could not do. This one proves it without
   * depending on any date arithmetic at all, and the two failure modes they
   * guard are different enough that dropping either would be a real loss:
   *
   *   - The journey block's anchor is DERIVED from the run date. If
   *     `preYearStartAnchorDaysAgo` is ever wrong — or management-fe's
   *     twelve-month payment-date cap tightens, moving the window it works
   *     inside — the anchor slides into the current year, the duly-made bound
   *     becomes the later one, and the block fails on the error wording. A
   *     fixture whose clock is an absolute instant cannot slide.
   *   - This block's anchor is `2025-11-14T00:00:00Z`, seeded by management-be
   *     and before 1 January of every year from 2026 on, so the year bound binds
   *     here permanently with nothing to re-point. But it is seeded, assigned to
   *     someone other than the stub user, and reached by search — none of which
   *     resembles how a caseworker's own case arrives. Only the journey block
   *     says the bound applies to an item built through the UI.
   *
   * ITS `accreditationYear: 2026` IS NO LONGER LOAD-BEARING and nothing here
   * asserts anything about it. That field was the whole reason this fixture
   * existed and the whole reason the previous revision's coverage was worthless;
   * the floor does not read the payload any more. The fixture is kept for its
   * CLOCK, which is the only part of it this block depends on. (management-be
   * confirmed on 5-Oct-2026 that the seed stays, with its invariant tests
   * re-pointed at the clock rather than the year.)
   *
   * Dates are still expressed relative to 1 January of the run's own year, for
   * the same reason as everywhere else in this file: the bound moves at new year
   * and the seeded clock does not, so a written-down date would drift from a
   * boundary case into an ordinary one without failing.
   */
  describe('1 January is the later bound on an absolutely-clocked fixture', () => {
    const currentYear = ukCalendarYear(new Date())
    const yearStart = yearStartDeadline()

    let seededWorkItemId

    before(async () => {
      await login.login()
      // Found by organisation name rather than by the seeder's deterministic id:
      // the name is a published constant that management-be unit-tests for
      // uniqueness across the seed set, so exactly one row comes back, whereas a
      // deterministic id would couple this spec to the id derivation.
      //
      // Through `findSeededWorkItemIdByOrgName` rather than a bare search, which
      // is a correction rather than a preference. Searching without resetting the
      // default filters first leaves the query implicitly scoped to the
      // logged-in assignee, and this fixture is not assigned to the stub user —
      // so the row exists and never appears, and the failure reads as "the
      // fixture is not seeded". See that helper for the full trap.
      //
      // The name differs by one word from the journey block's own item
      // ("...Journey Ltd"), deliberately, so this search cannot pick that up.
      seededWorkItemId = await workItems.findSeededWorkItemIdByOrgName(
        'RA-611 Pre Year Start Ltd'
      )
    })

    after(async () => {
      await login.logout()
    })

    it('rejects the day before 1 January, naming the CURRENT year (RA-611 AC4)', async () => {
      // 31 December of the previous year. Above this fixture's November 2025
      // anchor on any run from 2026 on, and one day below the bound — so it sits
      // in the gap where the two bounds disagree and only the LATER one can
      // refuse it. A build taking the earlier bound, or ignoring the year bound,
      // accepts it.
      await slaExtend.expectRejectedBeforeYearStart(seededWorkItemId, {
        reason: 'Backdating into the previous calendar year',
        date: dayBeforeYearStartDeadline(),
        year: currentYear
      })

      // The deadline must not have moved. Read from a fresh page load rather
      // than the re-rendered form, which only echoes what was typed.
      await workItems.openWorkItem(seededWorkItemId)
      await detail.assertNoFlashBanner()
    })

    it('accepts 1 January itself, the floor (RA-611 AC4 boundary)', async () => {
      // Run last in this block: it is the only case here that CHANGES the seeded
      // item, and it changes it to a date in the past — the corrected rule in one
      // assertion, a deadline months behind the run date accepted because it
      // clears this item's floor exactly.
      await workItems.openWorkItem(seededWorkItemId)
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.changeDeadline(seededWorkItemId, {
        reason: 'Backdating to the start of the current year',
        date: yearStart
      })

      await detail.assertFlashBanner()
      await detail.waitForDueOnToChangeFrom(before)
      await detail.assertCaseHeaderDueOn(deadlineDateFromParts(yearStart))
    })
  })
})
