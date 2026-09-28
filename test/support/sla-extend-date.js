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
 * RA-601 and it survives intact. What RA-611 forbids is landing on a date
 * earlier than TODAY. Today itself is accepted, so the floor is `< today`, not
 * `<= today`. The form has two rejections again: the past date, and the no-op
 * resubmission of the current deadline unchanged.
 *
 * The direction of a change and the position of its target are therefore
 * separate questions here, which is why the helpers below are named for where
 * the target date lands rather than for "extend" / "reduce".
 *
 * A short, fixed offset from today (e.g. "+7 days") is still not safe for the
 * cases that want a date the item has NOT already got: whether it differs
 * from the current due date depends on how far out that due date already is,
 * which these specs do not read or parse. The offsets below are large enough
 * to be unambiguous for every fixture in this suite without needing to.
 *
 * Every helper here returns midday rather than midnight: the parts are read
 * in the runner's local zone while the case header renders in Europe/London,
 * and a midnight instant can straddle the BST boundary into the previous
 * calendar day.
 */

import { ukDateParts } from './uk-time.js'

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

/**
 * RA-611. Today, yesterday, and an arbitrary number of days ago, as date-input
 * parts.
 *
 * WHY THESE COME OFF `ukDateParts` AND NOT `utcDateParts` OR THE RUNNER'S
 * CLOCK. RA-611's guard compares the submitted calendar date against "today",
 * and management-fe resolves that boundary in EUROPE/LONDON — confirmed with
 * the author of the guard on the RA-611 branch. It is deliberately not the UTC
 * boundary the same form's older checks use (`startOfUtcDay`), nor the UTC one
 * duly-making's payment date wants, so the obvious neighbour helper is the
 * wrong helper here.
 *
 * Getting the zone wrong would not fail loudly; it would fail for roughly one
 * hour a day for half the year. Through BST, Europe/London leads UTC into the
 * next calendar date from 23:00 UTC, so during that hour a UTC-derived "today"
 * is the UK's YESTERDAY — the boundary case would submit a date the form is
 * supposed to reject and report a correct build as broken. `ukDateParts`
 * applies its offset in whole days, so the arithmetic cannot straddle a
 * boundary either.
 *
 * Midday is used for the Date form, as everywhere else in this file, so the
 * value read back out of the Europe/London case header cannot slip a day.
 */
function middayFromUkDay(dayOffset) {
  const { day, month, year } = ukDateParts(new Date(), dayOffset)
  return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0)
}

/**
 * RA-611 (the boundary). Today is NOT "earlier than the current date", so it
 * must be accepted — the fix must land on `<` today, never `<=`.
 */
export function todayDeadlineDate() {
  return middayFromUkDay(0)
}

export function todayDeadline() {
  return dateParts(todayDeadlineDate())
}

/**
 * RA-611 (the rejection, at its tightest). One day is the smallest violation
 * there is, so this is the case that tells a correct `< today` guard apart
 * from one that is merely approximately right.
 */
export function yesterdayDeadlineDate() {
  return middayFromUkDay(-1)
}

export function yesterdayDeadline() {
  return dateParts(yesterdayDeadlineDate())
}

/**
 * RA-611. An arbitrary number of days in the past, so the spec can submit the
 * bug exactly as it was reported (a deadline 14 days back) rather than only a
 * synthetic one-day violation.
 */
export function daysAgoDeadlineDate(daysAgo) {
  return middayFromUkDay(-daysAgo)
}

export function daysAgoDeadline(daysAgo) {
  return dateParts(daysAgoDeadlineDate(daysAgo))
}

/**
 * A date before the SLA clock's `startedAt`.
 *
 * RA-611 MAKES THIS AN INVALID-INPUT GENERATOR AGAIN. RA-601 had turned it
 * into a valid one: with no lower bound at all, a date a year back saved, and
 * the product owner accepted that it sat before the clock started. RA-611
 * reinstates a floor at today, so a year back is once more rejected — not by
 * the extension-only bound RA-601 removed (earlier than the CURRENT DEADLINE
 * is still perfectly valid), but by the new past-date guard.
 *
 * Kept under this name because what it generates has not changed and the
 * before-the-clock-started property is still the interesting thing about it;
 * only its expected outcome flipped. Callers wanting a valid date that is
 * earlier than the current deadline want `earlierFutureDeadline()` against a
 * deadline pinned by `farFutureDeadline()`, or `todayDeadline()`.
 *
 * The clock is stamped during the spec run (the payment-received transition
 * in `dulyMake`), so any date comfortably in the past is before it. A year
 * back rather than yesterday: it must be unambiguously earlier than
 * `startedAt` regardless of the runner's zone and of how long fixture setup
 * took, and a whole year leaves no room to argue.
 *
 * Its history is worth keeping straight, because it has now been on both sides
 * twice: it began as `pastDeadline()`, feeding CM6's extension-only guard's
 * rejection case; RA-601 removed that guard and renamed it here as a
 * VALID-input generator; RA-611 makes it an invalid-input generator once more,
 * this time against the past-date guard. The date it returns never changed.
 */
export function beforeClockStartDeadlineDate() {
  return middayOffsetByYears(-1)
}

export function beforeClockStartDeadline() {
  return dateParts(beforeClockStartDeadlineDate())
}
