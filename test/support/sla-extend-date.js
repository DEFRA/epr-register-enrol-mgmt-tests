/**
 * Dates for the "Change determination deadline" date input.
 *
 * RA-447 (CM6) replaced the additionalDays count with an absolute calendar
 * date. It also shipped an extension-only lower bound — the new date had to
 * be strictly AFTER the item's current due date — which RA-601 removes: that
 * bound was an implementation assumption, never an AC, and RA-572's rename
 * from "Extend" to "Change" made it visibly wrong. A regulator may now move
 * the deadline in either direction.
 *
 * RA-611 puts back ONE bound, and it should not be read as a revert of RA-601.
 * Moving the deadline EARLIER THAN THE CURRENT DEADLINE stays valid — that is
 * RA-601 and it survives intact. What RA-611 forbids is landing BELOW A FLOOR:
 *
 *   floor = the LATER of
 *             (a) the SLA clock's start date — the duly-made anchor, i.e. the
 *                 first date the regulator had everything needed to determine
 *                 the application, and
 *             (b) 1 January of the CURRENT calendar year.
 *
 * (b) WAS WRONG UNTIL QA CAUGHT IT ON 5-OCT-2026 and the correction is the
 * reason several helpers below were re-pointed. The bound was read off the work
 * item payload's `accreditationYear` — the year the accreditation is VALID FOR,
 * which is always AHEAD of determination (management-be's config holds 2027) —
 * so live 2026 cases were floored at 1 January 2027 and had every date in 2026
 * refused, their own existing deadlines included. Anthony Moody's ACs say
 * "1st Jan of current year" and Giri confirmed the year is 2026; the bound is
 * now resolved from the clock, and nothing in this file may reach for an
 * accreditation year again.
 *
 * THE CORRECTION ALSO CHANGED WHO THE BOUND APPLIES TO, which matters more here
 * than the year does. The accreditation-year bound was inert on anything this
 * suite could create, because a UI-created work item carries no accreditation
 * year at all. The current year is always resolvable, so the 1-January bound now
 * applies to EVERY work item — which is what makes it reachable through the
 * ordinary journey, and also what makes the duly-made helpers below dependent on
 * their anchor staying inside the current year (see `DULY_MADE_DAYS_AGO`).
 *
 * BACKDATING INTO THE PAST IS THEREFORE LEGAL. An earlier revision of RA-611
 * floored the deadline at TODAY, and this file was written to that rule; the
 * spec was corrected on 29-Sep-2026 (Anthony Moody) and the today floor is
 * gone entirely. A past date at or above the floor SAVES. That is why the
 * helpers below are named for their position RELATIVE TO THE FLOOR rather than
 * relative to today — "yesterday" is no longer a meaningful category, and
 * naming a date for its distance from today would say nothing about whether
 * the form accepts it.
 *
 * The direction of a change and the position of its target are separate
 * questions here, which is why nothing below is named for "extend" / "reduce"
 * either.
 *
 * THE FLOOR IS A EUROPE/LONDON CALENDAR DATE, AND utcDateParts IS STILL THE
 * RIGHT WAY TO DERIVE IT HERE. Read both halves of that, because they look
 * contradictory and the reason they are not is the only thing keeping these
 * helpers correct.
 *
 * The rule, as implemented in both layers and confirmed with each: reject when
 * the submitted deadline's Europe/London calendar date is strictly earlier than
 * the later of the UK calendar date of `SlaClock.StartedAt` and 1 January of
 * the current calendar year. The clock's start is an INSTANT, so converting it
 * to a calendar date needs a zone, and that zone is Europe/London — as is the
 * year the second bound is taken from. (The today-floor revision briefly looked
 * as though it could drop to UTC; it cannot, and the distinction was settled
 * deliberately rather than left to whichever layer was read last.)
 *
 * The corrected rule DOES resolve a wall clock, where the withdrawn
 * accreditation-year reading did not — but only to the YEAR, so the floor moves
 * exactly once a year, at midnight on 1 January, and never mid-run.
 *
 * Every anchor this file is used against is midnight UTC — `dulyMake` stamps
 * the clock as `paymentDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc)` —
 * and midnight UTC carries the SAME calendar date in Europe/London under both
 * GMT (00:00) and BST (01:00). So for these fixtures the UK date and the UTC
 * date of the anchor are necessarily equal, and deriving the expectation from
 * the very same `utcDateParts` call that FILLED the payment-date field (see
 * `dulyMake` in re-accreditation-journey.js) is both correct and the only way
 * to stop the expectation drifting away from the input.
 *
 * THAT EQUIVALENCE DOES NOT GENERALISE. A clock with a real time-of-day — a
 * SEEDED item, whose clock is `submittedAt.AddDays(1)` — can sit on one
 * calendar date in UTC and the next in London (23:30 UTC on 14 Nov is 15 Nov in
 * London). Any spec pointed at a seeded fixture must format that fixture's
 * anchor as a LONDON date and must not reach for `utcDateParts`.
 *
 * Europe/London is also what renders the duly-made date inside the error
 * message, which management-fe formats with its GDS date filter. See
 * `gdsDateFromParts`.
 */

import { formatUkDateGds, ukCalendarYear, utcDateParts } from './uk-time.js'

function middayOffsetByYears(years) {
  const date = new Date()
  date.setFullYear(date.getFullYear() + years)
  date.setHours(12, 0, 0, 0)
  return date
}

function dateParts(date) {
  return {
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear()
  }
}

/**
 * RA-599. `yearsAhead` exists so one spec can change the SAME work item's
 * deadline more than once and still tell the resulting audit entries apart:
 * each change needs a date DISTINCT from the one the previous change set,
 * because the no-op resubmission is the only thing still rejected. It does not
 * need to be LATER — RA-601 removed that rule — but walking the offsets
 * upwards is the cheapest way to keep the dates distinct and the run
 * deterministic.
 *
 * Defaults to the original two years, so every no-argument caller is
 * unaffected.
 */
export function farFutureDeadlineDate(yearsAhead = 2) {
  return middayOffsetByYears(yearsAhead)
}

export function farFutureDeadline(yearsAhead = 2) {
  return dateParts(farFutureDeadlineDate(yearsAhead))
}

/**
 * RA-601. A future date that is EARLIER than `farFutureDeadline()` — the
 * reported bug in its purest form: a regulator pulling an already-pinned
 * deadline forwards.
 *
 * One year out rather than a handful of days, so the reduction is far larger
 * than the one-day rendering tolerance the case header carries (see
 * ra-295-case-header.e2e.js), and so it stays comfortably clear of both today
 * and the two-year fixture deadline whatever the time of year.
 */
export function earlierFutureDeadlineDate() {
  return middayOffsetByYears(1)
}

export function earlierFutureDeadline() {
  return dateParts(earlierFutureDeadlineDate())
}

// ── RA-611: the floor ─────────────────────────────────────────────────── //

/**
 * How far back the RA-611 floor fixture's payment date is set, and therefore
 * where its duly-made anchor — and its floor — sits.
 *
 * SIXTY DAYS, and the number is load-bearing in three directions at once:
 *
 *   - Far enough back that a date comfortably in the past can still sit ABOVE
 *     the floor, which is the whole point of the revised rule and impossible
 *     to demonstrate on an item duly made today.
 *   - Inside management-fe's payment-date validator, which floors back-dating
 *     at 12 months. Anything beyond that is rejected during fixture setup and
 *     the spec fails before it asserts anything.
 *   - Short enough that the anchor stays inside the CURRENT CALENDAR YEAR, so
 *     the duly-made bound is the later of the two and its message is the one
 *     that fires. The 1-January bound is exercised deliberately and separately;
 *     it must not gatecrash the duly-made cases.
 *
 * ⚠ THE THIRD POINT IS A REAL CONSTRAINT NOW, AND IT BREAKS IN JANUARY AND
 * FEBRUARY. It used to be protected for free: the bound read the payload's
 * `accreditationYear`, a UI-created item has none, and management-be returned
 * null rather than defaulting — so there was no 1-January bound at all on
 * anything this suite created, whatever the anchor. The corrected bound resolves
 * the current year from the clock, so it applies to every item, and sixty days
 * back falls into the PREVIOUS year on any run before roughly 1 March. On such a
 * run 1 January is the later bound, every rejection below reports the year
 * wording instead of the duly-made wording, and the duly-made block fails on the
 * message rather than on the rule.
 *
 * Left as a flat 60 rather than clamped, because clamping only moves the
 * problem: the duly-made bound can only BIND in the window between 1 January
 * and the anchor, and in early January that window is a few days wide — too
 * narrow to hold "a month below the floor" at all. The honest fix is a seeded
 * or injected clock, which this suite does not have. Until then this is a
 * known-dated gap, recorded here and in the PR, not a silent one.
 */
export const DULY_MADE_DAYS_AGO = 60

/**
 * A work item's floor as day/month/year parts, given how many days ago it was
 * duly made.
 *
 * `utcDateParts` rather than the runner's clock because the anchor is midnight
 * UTC of the payment date, and this is the same call that produced the payment
 * date in the first place — see `dulyMake` in re-accreditation-journey.js,
 * which fills the field from `utcDateParts(new Date(), dayOffset)`. Computing
 * the expectation a different way from the input is how an expectation drifts
 * away from it.
 */
export function dulyMadeAnchorDeadline(daysAgo = DULY_MADE_DAYS_AGO) {
  return utcDateParts(new Date(), -daysAgo)
}

/**
 * RA-611 (AC5, the boundary). The floor itself, which is ACCEPTED: the rule is
 * strictly-below, so a deadline landing exactly on the duly-made date passes.
 *
 * This is the case that stops the guard being written one day too strict — an
 * off-by-one here would refuse a regulator backdating to the very date the
 * application became determinable, which is the most defensible backdate there
 * is and the one the spec was written to permit.
 */
export function onFloorDeadline(daysAgo = DULY_MADE_DAYS_AGO) {
  return dulyMadeAnchorDeadline(daysAgo)
}

/**
 * RA-611 (AC2). A date in the PAST that is still above the floor, and so must
 * SAVE.
 *
 * THE MOST IMPORTANT GENERATOR IN THIS FILE, because the superseded today-floor
 * revision existed precisely to reject what this produces. Half the fixture's
 * back-dating, so it is unambiguously past, unambiguously above the anchor, and
 * a long way from both bounds — a guard that is merely approximately right in
 * either direction still fails it.
 */
export function pastDeadlineAboveFloor(daysAgo = DULY_MADE_DAYS_AGO) {
  return utcDateParts(new Date(), -Math.floor(daysAgo / 2))
}

/**
 * An arbitrary number of days in the past.
 *
 * Retained from the today-floor revision, where it produced the reported bug's
 * own date (a deadline fourteen days back) as a REJECTION case. Under the
 * corrected rule that same date SAVES on any item duly made more than fourteen
 * days ago, so the helper survives with its meaning inverted and its name — the
 * only thing it ever claimed — untouched.
 *
 * Callers must satisfy themselves that `daysAgo` clears the fixture's floor;
 * `pastDeadlineAboveFloor` exists for the callers that would rather not think
 * about it. Use this one where the SPECIFIC distance is the point.
 */
export function daysAgoDeadline(daysAgo) {
  return utcDateParts(new Date(), -daysAgo)
}

/**
 * RA-611 (AC3, at its tightest). One day below the floor.
 *
 * One day is the smallest violation there is, so this is what separates a
 * correct strictly-below guard from one that is off by a day in either
 * direction — a floor accidentally written at `anchor - 1` would still reject
 * the far-below case, and the bug would look fixed.
 */
export function justBelowFloorDeadline(daysAgo = DULY_MADE_DAYS_AGO) {
  return utcDateParts(new Date(), -(daysAgo + 1))
}

/**
 * RA-611 (AC3). Well below the floor — a month under it, so the rejection is
 * not resting on a single day's arithmetic.
 */
export function wellBelowFloorDeadline(daysAgo = DULY_MADE_DAYS_AGO) {
  return utcDateParts(new Date(), -(daysAgo + 30))
}

/**
 * Today, as date-input parts.
 *
 * Retained from the today-floor revision, where it was the boundary case, and
 * now merely an ordinary date that happens to be above every fixture's floor.
 * Still worth having: it is the shortest way to say "a deadline the regulator
 * is determining today", and on an item duly made today it IS the floor.
 *
 * Derived in UTC rather than Europe/London since the today-floor revision was
 * withdrawn — nothing in the rule resolves a wall clock any more, so the zone
 * this is computed in no longer changes any outcome. It matches the payment
 * date's zone, which is the one thing it still has to agree with.
 */
export function todayDeadlineDate() {
  const { day, month, year } = utcDateParts(new Date())
  return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0)
}

export function todayDeadline() {
  return dateParts(todayDeadlineDate())
}

/**
 * A date before the SLA clock's `startedAt`.
 *
 * RA-611 KEEPS THIS AN INVALID-INPUT GENERATOR, but for a different reason
 * than the today-floor revision gave. A year back is below the duly-made
 * anchor of every fixture in this suite, and the duly-made anchor is the floor
 * — so it is refused by the bound named after the clock rather than by any
 * rule about the past. Under the withdrawn today floor it was refused merely
 * for being in the past, which happened to look the same; under the revised
 * rule the ERROR MESSAGE differs, which is why the specs assert the text.
 *
 * Kept under this name because what it generates has not changed and the
 * before-the-clock-started property is now exactly the reason it is refused.
 * Callers wanting a PAST date that SAVES want `pastDeadlineAboveFloor()`
 * against an item duly made with a back-dated payment date; callers wanting a
 * valid date earlier than the current deadline want `earlierFutureDeadline()`
 * against a deadline pinned by `farFutureDeadline()`.
 *
 * A whole year rather than a day or two: it must be unambiguously earlier than
 * `startedAt` for an item duly made today AND for one duly made
 * `DULY_MADE_DAYS_AGO` back, regardless of the runner's zone and of how long
 * fixture setup took.
 *
 * Its history is worth keeping straight, because its expected outcome has moved
 * three times while the date it returns never changed: it began as
 * `pastDeadline()`, feeding CM6's extension-only guard; RA-601 removed that
 * guard and renamed it here as a VALID-input generator, the product owner
 * having explicitly accepted a deadline before the clock started; RA-611's
 * first revision made it invalid again via a floor at today; and the revised
 * RA-611 keeps it invalid but via the duly-made bound, which is the rule that
 * says what the product owner had actually meant.
 */
export function beforeClockStartDeadlineDate() {
  return middayOffsetByYears(-1)
}

export function beforeClockStartDeadline() {
  return dateParts(beforeClockStartDeadlineDate())
}

/**
 * Turn date-input parts back into the `Date` that `assertCaseHeaderDueOn` and
 * `formatUkDateGds` want.
 *
 * MIDDAY UTC, and both halves of that are deliberate. `Intl` needs an instant
 * where the parts describe only a calendar date, and the two obvious choices are
 * both wrong somewhere: a midnight-UTC instant renders as the PREVIOUS day in
 * any negative-offset zone and is one hour from doing so in Europe/London, while
 * a LOCAL midday (which the older helpers in this file use, safely, because
 * their callers only ever compare them to themselves) lands on the neighbouring
 * UTC date for runners at UTC+12 and beyond. Midday UTC has twelve hours of
 * clearance in both directions, so it renders as the intended calendar date in
 * every zone and in both GMT and BST.
 *
 * That matters here and not for the older helpers because these parts come from
 * `utcDateParts` and are handed to assertions that format in Europe/London —
 * a round trip through two different zones, which is exactly where a bare
 * calendar date acquires an off-by-one.
 */
export function deadlineDateFromParts({ day, month, year }) {
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12))
}

/**
 * Render date-input parts the way management-fe renders a date inside the
 * RA-611 floor error message: GDS `d MMMM yyyy` ("3 March 2026"), via its
 * `formatDateGds` Nunjucks filter.
 */
export function gdsDateFromParts(parts) {
  return formatUkDateGds(deadlineDateFromParts(parts))
}

// ── RA-611: the 1-January bound, at the CURRENT year ──────────────────── //

const DAY_MS = 86_400_000

/**
 * management-fe's payment-date floor, in months (`MAX_AGE_MONTHS` in its
 * `duly-making/payment-date.js`). Mirrored rather than imported — this suite
 * treats management-fe as a black box — and it caps how far back a duly-made
 * anchor can be placed, which is the binding constraint on everything below.
 */
const PAYMENT_DATE_MAX_AGE_MONTHS = 12

/** The UTC midnight of `now` shifted by whole days, as an epoch instant. */
function utcMidnight(now, dayOffset = 0) {
  const { day, month, year } = utcDateParts(now, dayOffset)
  return Date.UTC(Number(year), Number(month) - 1, Number(day))
}

/** A UTC-midnight instant back as date-input parts. */
function partsOfUtcMidnight(instant) {
  const date = new Date(instant)
  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear()
  }
}

/** The midpoint of two UTC-midnight instants, floored to a whole day. */
function midpointDay(from, to) {
  return from + Math.floor((to - from) / DAY_MS / 2) * DAY_MS
}

/**
 * 1 January of the run's own calendar year — the bound itself, which is
 * ACCEPTED.
 *
 * Europe/London via `ukCalendarYear`, because that is where management-fe takes
 * the year from. The surrounding arithmetic is done on UTC midnights, and the
 * two cannot disagree about the year: 1 January always falls inside GMT, where
 * London and UTC are the same clock.
 */
export function yearStartDeadline(now = new Date()) {
  return { day: 1, month: 1, year: ukCalendarYear(now) }
}

/**
 * 31 December of the previous year — one day below the bound, and the smallest
 * violation of it there is.
 *
 * EXPRESSED RELATIVE TO 1 JANUARY OF THE RUN'S OWN YEAR, never written down.
 * "December 2025 is rejected" is a true sentence that stops meaning anything the
 * moment the clock passes into 2027: the floor moves on 1 January, and a
 * hard-coded date drifts from a boundary case into an ordinary one without
 * failing.
 */
export function dayBeforeYearStartDeadline(now = new Date()) {
  return partsOfUtcMidnight(Date.UTC(ukCalendarYear(now), 0, 1) - DAY_MS)
}

/**
 * How far back to back-date a fixture's payment date so that its duly-made
 * anchor lands BEFORE 1 January of the current year — which is what makes the
 * year bound the LATER of the two, and so the one that binds.
 *
 * THIS IS WHY THE YEAR BOUND NO LONGER NEEDS A SEEDED FIXTURE. Under the
 * withdrawn accreditation-year reading it did: nothing created through the
 * case-management UI carried an accreditation year, so the bound was inert on
 * every item this suite could build, and management-be had to seed one. The
 * current year is always resolvable, so an ordinary journey item qualifies as
 * soon as its anchor is back-dated far enough.
 *
 * COMPUTED, NOT A CONSTANT, and the two ends are why. The anchor has to sit
 * inside a window bounded on both sides:
 *
 *   earliest: `PAYMENT_DATE_MAX_AGE_MONTHS` before today — management-fe refuses
 *             an older payment date, and the fixture would fail during setup.
 *   latest:   31 December of the previous year — any later and the anchor is the
 *             later bound, the duly-made message fires instead, and the specs
 *             fail on the wording rather than the rule.
 *
 * That window is never empty (today minus twelve months is always in the
 * previous calendar year) but its width is roughly the number of days LEFT in
 * the year, so it is ~88 days wide in early October and one day wide on
 * 31 December. Taking the MIDPOINT spends the available room evenly on both
 * constraints instead of hugging whichever end a fixed offset happened to
 * favour: a flat -300 clears both today, with 44 days to spare, and silently
 * stops reaching the previous year at all from about 28 October onwards.
 */
export function preYearStartAnchorDaysAgo(now = new Date()) {
  const today = utcMidnight(now)
  const latest = Date.UTC(ukCalendarYear(now), 0, 1) - DAY_MS

  // Calendar-month arithmetic, the same way management-fe's validator does it,
  // so this agrees with the check it has to satisfy rather than approximating
  // twelve months as 365 days.
  const earliestDate = new Date(today)
  earliestDate.setUTCMonth(
    earliestDate.getUTCMonth() - PAYMENT_DATE_MAX_AGE_MONTHS
  )

  return Math.round(
    (today - midpointDay(earliestDate.getTime(), latest)) / DAY_MS
  )
}

/**
 * A date below BOTH bounds: a month under the anchor, which is itself below
 * 1 January.
 *
 * Only the LATER bound may be reported, so this must still produce the
 * 1-January message. A build reporting the duly-made date here would send the
 * caseworker to correct the date to an anchor that is itself refused.
 *
 * No payment-date floor applies to it — it goes in the determination-deadline
 * field, not the payment-date field — so it is free to predate the twelve-month
 * window that constrains the anchor.
 */
export function belowPreYearStartAnchorDeadline(now = new Date()) {
  return utcDateParts(now, -(preYearStartAnchorDaysAgo(now) + 30))
}

/**
 * A date in the PAST that is above both bounds, and so must SAVE: the midpoint
 * between 1 January of the current year and today.
 *
 * THE CASE THAT CANNOT PASS AGAINST THE BROKEN BUILD, which is why it is here
 * rather than left to the duly-made block's equivalent. The defect QA found
 * floored determination at 1 January of the ACCREDITATION year — 2027 — and so
 * refused every date in 2026, this one included. A suite of rejection cases
 * would have stayed green against it.
 *
 * The midpoint rather than a fixed distance back so it keeps clearance from both
 * ends whatever the time of year. It degenerates to 1 January itself on a 1-Jan
 * run, where no past date can clear the bound at all; the caller re-pins the
 * deadline between its acceptance cases so that collision cannot surface as a
 * no-op rejection.
 */
export function pastDeadlineAboveYearStart(now = new Date()) {
  const yearStart = Date.UTC(ukCalendarYear(now), 0, 1)
  return partsOfUtcMidnight(midpointDay(yearStart, utcMidnight(now)))
}
