# RA-462 — Concurrent logins: E2E test plan (management journey tests)

**Status:** Plan only — the spec is not written yet. Enforcement is pending
product/security sign-off on the single-active-session policy
(`epr-register-enrol-frontend/docs/adr/0001-single-active-session-per-user.md`;
caseworker-app deltas in
`epr-register-enrol-management-fe/docs/RA-462-concurrent-logins-design.md`).
**Branch:** `feature/RA-462-ConcurrentLogins`

## What is being verified

> A fresh login for a caseworker identity invalidates that identity's prior
> session (another browser/device). The prior session's next request redirects
> to the sign-in page.

This is the session-concurrency sibling of RA-306 (`ra-306-sign-out.e2e.js`).
RA-306 proves an explicit sign-out kills the session; RA-462 proves a second
login kills the *first* session.

## Approach in this WDIO suite

Single Chrome instance. Two cookie jars in one run, reusing `login.page.js`
helpers (`login()`, `waitForSignInPage()`, `hasAuthenticatedNav()`):

1. `login.login()` as the caseworker (lands on `/work-items`).
2. Capture session A: `const sessionA = await browser.getCookies()`.
3. `await browser.reloadSession()` (fresh jar) — or `browser.deleteCookies()` —
   then `login.login()` again as the same caseworker. Session B.
4. Sanity: session B loads `/work-items`, `hasAuthenticatedNav()` is `true`.
5. `await browser.deleteCookies(); await browser.setCookies(sessionA)`.
6. `await browser.url('/work-items')`.
7. **Assert** `login.waitForSignInPage()` — session A is redirected to sign-in;
   `hasAuthenticatedNav()` is `false`; no work-items content rendered.

Add a positive-control case: session B (the newer one) still works after A is
killed — guards against an implementation that nukes *all* sessions including
the one just created.

Regression case: a single caseworker logging in once, doing normal work, and
signing out via the nav behaves exactly as in `ra-306-sign-out.e2e.js`.

Support-user path (`login.loginAsSupportUser()`): a second support-user login
invalidates the first support-user session too.

## New spec

`test/specs/ra-462-concurrent-logins.e2e.js`

```
describe('RA-462 concurrent logins — single active caseworker session', () => {
  it('second login invalidates the first session', ...)
  it('the second (surviving) session keeps working', ...)
  it('support user: second login invalidates the first', ...)
  it('single-session login/logout is unaffected', ...)   // regression vs RA-306
})
```

Page-object additions (`test/page-objects/login.page.js`): small
`captureSession()` / `restoreSession(cookies)` wrappers around
`browser.getCookies()` / `deleteCookies()` + `setCookies()` so the spec stays
readable. `waitForSignInPage()` already exists and asserts both heading and an
`/auth/...login` URL — reuse it verbatim.

## Environment assumptions

- Runs against the stub-auth management deployment (as `ra-306-sign-out` and
  `auth-flows` do); no real Entra ID needed for the automated check.
- `epr-register-enrol-management-fe` under test must be built from
  `feature/RA-462-ConcurrentLogins` (registry + supersede check present, and —
  per the design doc — ideally `maxCookieSize: 0` set so session state is
  reliably server-side). Until that lands the spec is committed **skipped**
  (`describe.skip`) with a comment pointing here, so CI stays green.
- Note the ordering caveat from RA-306's doc block: a green result on a
  pre-enforcement build would mean this spec is testing nothing. The
  positive-control ("second session still works") case makes an accidental
  all-pass less likely, but treat an unexpectedly-green skip-removed run on an
  un-updated management-fe as a failure.

## Manual verification (EXT-TEST / management)

Tracked in the management-fe design doc §5:

1. Same caseworker (real Entra ID) in two browsers → first is signed out after
   the second login completes.
2. Single-browser login/logout and RA-299 work-items filter behaviour unchanged.
