# RA-462 — Concurrent-login notification: E2E (management journey tests)

**Status:** Implemented — `test/specs/ra-462-concurrent-logins.e2e.js`, live
(not `describe.skip`). It runs against `epr-register-enrol-management-fe` built
from a branch matching this PR's head ref (`run-journey-tests` resolves it by
exact branch name; both branches are `feature/RA-462-ConcurrentLogins`).

The concurrency sibling of `ra-306-sign-out.e2e.js`: RA-306 proves an explicit
sign-out kills the session; this proves a second login does not — it only
notifies.

## What the spec asserts

Single Chrome instance, two cookie jars: `login.login()` (jar A),
`browser.getCookies()`, `browser.reloadSession()`, `login.login()` again as the
same caseworker.

1. **the just-signed-in session (B) sees a session-notice** —
   `[data-testid="session-notice"]` is displayed.
2. **the already-active session (A) is not signed out** — restore jar A,
   navigate to `/work-items`, assert the URL is not `/auth/regulator/login` and
   `login.hasAuthenticatedNav()` is `true`.
3. **the notice dismisses** — on session B, click
   `[data-testid="session-notice-dismiss"]` and assert the notice is gone.

The spec uses raw WDIO `$(...)` selectors for the notice rather than new
`login.page.js` helpers — the notice is a single component with stable
`data-testid` hooks, so page-object methods would add indirection without
value here.

## Deliberately not asserted here

The `alert` vs `info` variant, the "a new sign-in was detected" wording,
dismissal persistence across navigations, and the third-login re-raise are
**covered by `concurrent-login.test.js` in
`epr-register-enrol-management-fe`**. Reason: the journey grid runs many
parallel browsers as the **same** stub caseworker, so the per-identity
registry that decides the alert variant is churned continuously by other
specs — a single spec cannot pin it. The two assertions that do run target the
just-signed-in session, whose notice comes from its own yar session flag.

No-JS fallback: covered by the component test in the management-fe repo.

## Manual verification (EXT-TEST / management)

Same caseworker in two real browsers: the second shows the "signed in
elsewhere" notice; the first, on its next page, shows "a new sign-in was
detected" with a sign-out link and stays usable; dismiss clears it; a third
sign-in re-raises it. RA-299 work-items filters and RA-306 sign-out unchanged.
Screen-reader pass on both variants.
