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

  async logout() {
    await this.open('/auth/logout')
    await expect($('h1=Stub Login')).toBeDisplayed()
  }

  /**
   * RA-306. The stub sign-in page — where an unauthenticated visitor and a
   * just-signed-out user must both end up. Matched on the H1 because the stub
   * chooser carries no `data-testid` of its own; every other selector in this
   * suite prefers a testid.
   */
  signInHeading() {
    return $('h1=Stub Login')
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
   */
  async signOutViaNav() {
    await this.navSignOut().click()
    await this.waitForSignInPage()
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
