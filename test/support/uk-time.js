/**
 * Helpers for asserting that the case management UI renders timestamps in UK
 * local time (Europe/London).
 *
 * The backend stores and returns every timestamp in UTC; the frontend is the
 * only place that converts to the user-facing zone. These helpers compute the
 * expected display string with an EXPLICIT Europe/London timezone (never the
 * test runner's own TZ), so the expectation reflects BST (UTC+1) / GMT (UTC+0)
 * correctly on any CI machine and mirrors the frontend's `formatDateTimeGds`
 * Nunjucks filter exactly.
 */

/**
 * Format a Date the way the case management UI does: GDS date-time in UK local
 * time, e.g. "27 April 2026 at 11:00am" (no leading-zero hour, lowercase
 * am/pm, no space before the meridiem).
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatUkDateTimeGds(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value ?? ''
  const period = get('dayPeriod').toLowerCase().replace(/[.\s]/g, '')
  return `${get('day')} ${get('month')} ${get('year')} at ${get('hour')}:${get('minute')}${period}`
}

/**
 * Format a Date as a GDS date in UK local time, e.g. "24 August 2026".
 *
 * Used for list cards and messages. The case header renders RA-493's shorter
 * "01 Nov 2026" form instead, so header assertions use `formatUkHeaderDate`.
 * A date, not a timestamp, but it still has to be computed in Europe/London
 * rather than the runner's TZ: an SLA deadline that lands just after midnight
 * BST is the *previous* day in UTC, so formatting in UTC would assert the
 * wrong date for part of the year — exactly the class of bug these helpers
 * exist to catch.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatUkDateGds(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date)
}

/**
 * Month abbreviations exactly as date-fns' `MMM` token renders them.
 *
 * Deliberately NOT `Intl.DateTimeFormat('en-GB', { month: 'short' })`: modern
 * ICU abbreviates September as "Sept" in en-GB, while management-fe formats
 * with date-fns, which renders "Sep". Using Intl here would make every header
 * date assertion fail for one month a year.
 */
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

/**
 * Format a Date as the case header renders its dates, in UK local time:
 * two-digit day, short month, e.g. "01 Nov 2026" (date-fns `dd MMM yyyy`).
 *
 * RA-493 moved the case header's "Due date" and "Payment date" to this
 * format. Everywhere else (list cards, error messages) keeps the long
 * `formatUkDateGds` form, so only header assertions should use this. Computed
 * in Europe/London for the same reason as `formatUkDateGds`.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatUkHeaderDate(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: 'numeric',
    year: 'numeric'
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('day')} ${SHORT_MONTHS[Number(get('month')) - 1]} ${get('year')}`
}

/**
 * The set of acceptable UK-local GDS strings for an event that happened "about
 * now", allowing for the delay between the server creating the record and the
 * test reading the rendered page. Returns one string per minute across the
 * trailing `toleranceMinutes` window so the assertion stays deterministic
 * without being flaky around minute boundaries.
 *
 * @param {Date} now
 * @param {number} [toleranceMinutes]
 * @returns {Set<string>}
 */
/**
 * Split a Date into the day/month/year numbers a GOV.UK date input expects,
 * evaluated in UTC.
 *
 * RA-316 needs this for the payment-date field, and it MUST be UTC to match
 * the field's validation: management-fe's `validatePaymentDate` computes
 * "today" in UTC deliberately, "to match the backend's notion of 'today'".
 * Evaluating the parts in Europe/London instead puts them a day AHEAD of UTC
 * for the ~1h each evening that BST leads UTC into the next date (23:00–24:00
 * UTC) — so the today-is-valid case would submit what the backend sees as a
 * FUTURE date and be rejected with 400. (That timezone mismatch is what broke
 * every duly-making journey spec overnight.) The offset is applied in whole
 * days so the arithmetic never straddles a boundary.
 *
 * @param {Date} date
 * @param {number} [dayOffset] days to add (negative for the past)
 * @returns {{day: string, month: string, year: string}}
 */
export function utcDateParts(date, dayOffset = 0) {
  const shifted = new Date(date.getTime() + dayOffset * 86_400_000)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric'
  }).formatToParts(shifted)
  const get = (type) => parts.find((p) => p.type === type)?.value ?? ''
  return { day: get('day'), month: get('month'), year: get('year') }
}

export function recentUkDateTimeGdsWindow(now, toleranceMinutes = 5) {
  const window = new Set()
  for (let minutesAgo = 0; minutesAgo <= toleranceMinutes; minutesAgo++) {
    window.add(
      formatUkDateTimeGds(new Date(now.getTime() - minutesAgo * 60_000))
    )
  }
  return window
}
