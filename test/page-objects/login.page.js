import { browser, $, expect } from '@wdio/globals'
import { Page } from './page.js'

class LoginPage extends Page {
  /**
   * Stub-login. RA-323: every caseworker holds the same role, so there is
   * no role selection any more. Pass an optional `nation`
   * (England/Scotland/Wales/NorthernIreland) to attach a single nation-scoped
   * role to the user — used to exercise the RA-125 nation auto-default on the
   * work-items list. Omitting `nation` (or passing a falsy value) leaves the
   * user with no nation role, i.e. a multi-nation "see all" user.
   */
  async login(nation) {
    await this.open('/auth/regulator/login')
    if (nation) {
      await $('select[name="nation"]').selectByAttribute('value', nation)
    }
    await $('button=Log in').click()
    await browser.waitUntil(
      async () => new URL(await browser.getUrl()).pathname === '/work-items'
    )
  }

  /**
   * RA-449: /auth/logout now lands on the logged-out interstitial rather
   * than the sign-in page directly, so teardown asserts that page instead.
   * Note this is a weaker assertion than the old one: /auth/logged-out is
   * auth: false and renders the same whether or not a session survived, so
   * this only proves the page is reachable, not that the session was
   * actually destroyed. Specs that need that guarantee (AC02/AC03 in
   * ra-306-sign-out, auth-flows) assert it explicitly by re-requesting a
   * protected page.
   */
  async logout() {
    await this.open('/auth/logout')
    await expect(this.loggedOutHeading()).toBeDisplayed()
  }

  /**
   * RA-306. The stub sign-in page — where an unauthenticated visitor lands.
   * Matched on the H1 because the stub chooser carries no `data-testid` of
   * its own; every other selector in this suite prefers a testid.
   */
  signInHeading() {
    return $('h1=Stub Login')
  }

  /**
   * RA-449. The interstitial shown after logging out, before the user
   * chooses to sign back in. The heading text ("You have been signed out")
   * is user-facing copy and stays in sign in/out language even though the
   * route and helpers around it follow the codebase's login/logout naming.
   *
   * Matched on text via the shared `app-heading-title` testid rather than
   * testid alone: that testid is generic to every page using the heading
   * component, so matching only on it would confirm a heading rendered but
   * not that it's this page's — the exact copy is the actual assertion here.
   */
  loggedOutHeading() {
    return $('h1=You have been signed out')
  }

  /**
   * RA-449 (AC01/AC02). Assert we are on the logged-out interstitial: both
   * the heading AND the /auth/logged-out URL, for the same reason
   * waitForSignInPage below checks both — a stale authenticated page that
   * merely failed to repaint would still be sitting on its own path.
   */
  async waitForLoggedOutPage() {
    await this.loggedOutHeading().waitForDisplayed()
    await browser.waitUntil(
      async () => {
        const { pathname } = new URL(await browser.getUrl())
        return pathname === '/auth/logged-out'
      },
      {
        timeoutMsg: `Expected to be redirected to the logged-out page, got ${await browser.getUrl()}`
      }
    )
  }

  /**
   * RA-449. Continue from the logged-out interstitial to the sign-in page,
   * the way a real user would by clicking its "Sign in" button.
   */
  async continueToLogin() {
    await $('[data-testid="logged-out-login"]').click()
    await this.waitForSignInPage()
  }

  /**
   * RA-449. Wait for the logged-out interstitial to actually be there, then
   * click its "Sign in" button — without waiting for the sign-in page
   * afterward. Used by callers that need their own (longer) timeout on the
   * wait that follows — see ra-306-sign-out AC03, whose back-button
   * refetch-then-redirect is slower than the default `continueToLogin()`
   * tolerates under parallel CI load.
   *
   * The explicit `waitForLoggedOutPage()` first (rather than a bare click,
   * as `continueToLogin()` does) matters here specifically: AC03 reaches
   * this page via `browser.back()`, a history-traversal refetch that can
   * still be settling when the click is attempted, unlike the other
   * callers which arrive via a completed forward navigation.
   */
  async proceedPastLoggedOutPage() {
    await this.waitForLoggedOutPage()
    await $('[data-testid="logged-out-login"]').click()
  }

  /**
   * RA-306 (AC01/AC02/AC03). Assert we are on the sign-in page: both the
   * heading AND an /auth/…login URL. The URL check matters because a stale
   * authenticated page that merely failed to repaint would still be sitting on
   * its own path — asserting the heading alone would not catch a back-button
   * regression where the browser served the previous page from cache.
   *
   * The path is asserted loosely (an /auth/ path containing "login") rather
   * than pinned to one route, because sign-out lands on the stub chooser while
   * a direct visit uses /auth/regulator/login, and both satisfy the AC.
   *
   * `timeout` defaults to the suite-wide waitforTimeout. AC03's back-button
   * case passes a longer one: unlike a click-triggered redirect, that path is
   * a full history-traversal refetch — browser back-nav, a server round trip
   * that revalidates the destroyed session and 401s, then the redirect's own
   * navigation — three network legs against the shared default's one, and
   * this was observed timing out at the default under parallel CI load with
   * no code change either side of the flake.
   */
  async waitForSignInPage({ timeout } = {}) {
    await this.signInHeading().waitForDisplayed(
      timeout ? { timeout } : undefined
    )
    await browser.waitUntil(
      async () => {
        const { pathname } = new URL(await browser.getUrl())
        return pathname.startsWith('/auth/') && pathname.includes('login')
      },
      {
        ...(timeout ? { timeout } : {}),
        timeoutMsg: `Expected to be redirected to the sign-in page, got ${await browser.getUrl()}`
      }
    )
  }

  /**
   * RA-306 (AC01). Sign out the way a real user does — the "Sign out" item in
   * the service nav, present on every authenticated page (the hook lives on
   * the base Page). Deliberately distinct from `logout()` above, which GETs
   * /auth/logout directly and exists for test teardown: only this path proves
   * the AC that the nav control terminates the session.
   *
   * RA-449: lands on the logged-out interstitial, not the sign-in page — see
   * waitForLoggedOutPage.
   */
  async signOutViaNav() {
    await this.navSignOut().click()
    await this.waitForLoggedOutPage()
  }

  /**
   * RA-306 (AC01). Whether the session-bearing service nav is on the page at
   * all. A signed-out visitor must not see the "Sign out" control, so this is
   * the cheap positive signal that a page is rendering authenticated content.
   */
  async hasAuthenticatedNav() {
    return this.navSignOut().isExisting()
  }

  /**
   * RA-335. Stub sign-in as the read-only support user, via the "Sign in
   * as support user" button on the stub chooser — a separate form from the
   * caseworker login above, so there is no nation to select.
   */
  async loginAsSupportUser() {
    await this.open('/auth/regulator/login')
    await $('[data-testid="stub-support-login"]').click()
    await browser.waitUntil(
      async () => new URL(await browser.getUrl()).pathname === '/work-items'
    )
  }
}

export default new LoginPage()
