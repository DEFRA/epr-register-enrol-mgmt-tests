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

/**
 * Split a Date into the day/month/year numbers a GOV.UK date input expects,
 * evaluated in Europe/London.
 *
 * The UK-local sibling of `utcDateParts`, added for RA-611. Both exist on
 * purpose, and which one a spec wants is decided by the validator it is
 * driving, never by preference:
 *
 *   - `utcDateParts` for duly-making's payment date, whose validator computes
 *     "today" in UTC deliberately "to match the backend's notion of 'today'".
 *   - `ukDateParts` for RA-611's determination-deadline floor, whose validator
 *     resolves the UK-local calendar date with Intl and compares against the
 *     UTC midnight of that UK date (confirmed with management-fe on the
 *     RA-611 branch, not inferred from the pre-RA-611 `startOfUtcDay` helper
 *     that still serves other checks on the same form).
 *
 * The two disagree for the hour after UK midnight through BST, when London has
 * already rolled into the next calendar date and UTC has not (23:00–24:00 UTC).
 * Using the wrong one there does not fail loudly — it silently submits the
 * neighbouring day, so a "today is accepted" case submits YESTERDAY and reports
 * a correct build as broken, once a day for half the year. That is the entire
 * reason this function exists rather than callers sharing the UTC one.
 *
 * The offset is applied in whole days so the arithmetic never straddles a
 * boundary, matching `utcDateParts`.
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
