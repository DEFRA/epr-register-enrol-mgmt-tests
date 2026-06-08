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
export function recentUkDateTimeGdsWindow(now, toleranceMinutes = 5) {
  const window = new Set()
  for (let minutesAgo = 0; minutesAgo <= toleranceMinutes; minutesAgo++) {
    window.add(
      formatUkDateTimeGds(new Date(now.getTime() - minutesAgo * 60_000))
    )
  }
  return window
}
