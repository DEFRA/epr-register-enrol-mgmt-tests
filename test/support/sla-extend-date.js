/**
 * Dates for the "Change determination deadline" date input.
 *
 * RA-447 (CM6) replaced the additionalDays count with an absolute calendar
 * date. It also shipped an extension-only lower bound — the new date had to
 * be strictly AFTER the item's current due date — which RA-601 removes: that
 * bound was an implementation assumption, never an AC, and RA-572's rename
 * from "Extend" to "Change" made it visibly wrong. A regulator may now move
 * the deadline in either direction, including to a date before today and
 * before the SLA clock started. The only submission still rejected is the
 * no-op: resubmitting the current deadline unchanged.
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

export function farFutureDeadlineDate() {
  return middayOffsetByYears(2)
}

export function farFutureDeadline() {
  return dateParts(farFutureDeadlineDate())
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
 * RA-601. A date before the SLA clock's `startedAt`.
 *
 * The clock is stamped during the spec run (the payment-received transition
 * in `dulyMake`), so any date comfortably in the past is before it. A year
 * back rather than yesterday: it must be unambiguously earlier than
 * `startedAt` regardless of the runner's zone and of how long fixture setup
 * took, and a whole year leaves no room to argue.
 *
 * The product owner explicitly accepted this as valid input, so this is a
 * VALID-input generator. It was `pastDeadline()` before RA-601, where it fed
 * the extension-only guard's rejection case; the guard is gone, the date is
 * now expected to save, and the name had to move with the meaning.
 */
export function beforeClockStartDeadlineDate() {
  return middayOffsetByYears(-1)
}

export function beforeClockStartDeadline() {
  return dateParts(beforeClockStartDeadlineDate())
}
