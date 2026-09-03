# RA-462 — Concurrent logins: E2E test plan (management journey tests)

**Status:** Plan only — the spec is not written yet. Policy chosen by product on
2026-09-02: **allow concurrent sessions, show a dismissible toast** (no forced
sign-out). See
`epr-register-enrol-management-fe/docs/RA-462-concurrent-logins-design.md`.
**Branch:** `feature/RA-462-ConcurrentLogins`

## What is being verified

A second login for the same caseworker identity leaves both sessions usable; the
older session shows an **alert** toast, the newer shows an **info** toast;
dismissal sticks until a newer sign-in; a no-JS banner fallback works.

This is the concurrency sibling of RA-306 (`ra-306-sign-out.e2e.js`): RA-306
proves an explicit sign-out kills the session; RA-462 proves a *second login*
does **not** — it only notifies.

## Approach in this WDIO suite

Single Chrome instance; two cookie jars, reusing `login.page.js`
(`login()`, `hasAuthenticatedNav()`):

1. `login.login()` as the caseworker (lands on `/work-items`).
2. `const sessionA = await browser.getCookies()`.
3. `browser.reloadSession()` → `login.login()` again as the same caseworker.
   Session B.
4. **Assert (info):** session B's first page shows
   `[data-testid="session-notice"][data-variant="info"]`.
5. `browser.deleteCookies(); browser.setCookies(sessionA)`;
   `browser.url('/work-items')`.
6. **Assert (alert):** session A shows
   `[data-testid="session-notice"][data-variant="alert"]` with a sign-in time
   and a sign-out link, `hasAuthenticatedNav()` is still `true`, and the
   work-items list rendered — A was **not** redirected to `/auth/regulator/login`.
7. **Assert (dismiss):** close the toast → gone; reload → still gone.
8. **Assert (re-raise):** third login (Browser C) → restore `sessionA` →
   navigate → alert toast back.

No-JS case: Chrome with JavaScript disabled — banner renders in-flow, its "Hide"
form post removes it.

Support-user path (`login.loginAsSupportUser()`): a second support-user login
raises the toasts likewise.

## New spec

`test/specs/ra-462-concurrent-logins.e2e.js`

```
describe('RA-462 concurrent logins — new-sign-in notification', () => {
  it('second login: both caseworker sessions stay usable', ...)
  it('older session shows the alert toast', ...)
  it('newer session shows the info toast', ...)
  it('dismissal sticks until a newer sign-in', ...)
  it('a third login re-raises the alert', ...)
  it('support user: second login raises the toast', ...)
  it('no-JS: in-flow banner with a working Hide link', ...)
  it('single-session login/logout is unaffected', ...)   // regression vs RA-306
})
```

Page-object additions (`test/page-objects/login.page.js`): `sessionNotice(variant)`,
`dismissSessionNotice()`, `captureSession()` / `restoreSession(cookies)`.

## Environment assumptions

- Runs against the stub-auth management deployment (as `ra-306-sign-out` and
  `auth-flows` do).
- `epr-register-enrol-management-fe` under test built from
  `feature/RA-462-ConcurrentLogins` with the notification implemented (and,
  per the design doc, ideally `maxCookieSize: 0` set). Until then the spec is
  committed **skipped** with a comment pointing here.
- `SESSION_CONCURRENT_LOGIN_NOTICE_ENABLED` = `true` (default).

## Manual verification (EXT-TEST / management)

Management-fe design doc §5: two real browsers, info on newer / alert on older,
both usable, dismissal sticks, third login re-raises, no-JS fallback,
screen-reader pass; RA-299 filters and RA-306 sign-out unchanged.
