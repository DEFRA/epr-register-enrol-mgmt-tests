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
 * RA-295's case-header "Due on" is a date, not a timestamp. It still has to be
 * computed in Europe/London rather than the runner's TZ: an SLA deadline that
 * lands just after midnight BST is the *previous* day in UTC, so formatting in
 * UTC would assert the wrong date for part of the year — exactly the class of
 * bug these helpers exist to catch.
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
 * evaluated in Europe/London rather than the runner's TZ.
 *
 * RA-316 needs this for the payment-date field. Taking the parts from the
 * runner's local calendar would put the boundary tests one day out for part
 * of the year — "today" computed in UTC is already "tomorrow" in BST for an
 * hour each evening, which would make the today-is-valid case fail as a
 * future date. The offset is applied in whole days BEFORE formatting so the
 * arithmetic never straddles a DST change.
 *
 * @param {Date} date
 * @param {number} [dayOffset] days to add (negative for the past)
 * @returns {{day: string, month: string, year: string}}
 */
export function ukDateParts(date, dayOffset = 0) {
  const shifted = new Date(date.getTime() + dayOffset * 86_400_000)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
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
