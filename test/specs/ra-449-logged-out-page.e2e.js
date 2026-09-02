import { browser, expect } from '@wdio/globals'

import login from '../page-objects/login.page.js'

/**
 * RA-449 — Case Management service: Signed out page.
 *
 * Previously both `/auth/logout` and a session-expiry 401 sent the caller
 * straight to Entra ID's own login page, which (with an active Entra ID
 * browser session) could sign the user straight back in with no visible
 * confirmation that sign-out had happened at all. RA-449 puts an
 * interstitial in between for the explicit sign-out path: clicking
 * "Sign out" now shows a "You have been signed out" page with its own
 * "Sign in" button, rather than bouncing straight back to the identity
 * provider.
 *
 * Session-expiry (401) redirects to login are unchanged and out of scope
 * here — see auth-redirect.js's redirectToLogin, covered elsewhere.
 */
describe('RA-449 logged-out page', () => {
  // Each test signs itself in from a clean, signed-out start rather than
  // sharing a `before`: the first test ends signed out (that's the thing it's
  // proving), so a shared login would leave the second test trying to sign
  // out again with no session and no "Sign out" nav control to click.
  beforeEach(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  it('shows the logged-out page, not the sign-in page, right after signing out', async () => {
    await login.signOutViaNav()

    await expect(login.loggedOutHeading()).toBeDisplayed()
    expect(new URL(await browser.getUrl()).pathname).toBe('/auth/logged-out')
  })

  it('offers a Sign in button that leads back into a working sign-in', async () => {
    await login.signOutViaNav()
    await login.continueToLogin()

    // continueToLogin() has already asserted we landed on the sign-in page
    // via waitForSignInPage(); signing in from there through the normal page
    // object proves the button is a genuine, working entry point rather than
    // just a link that happens to resolve to the right URL.
    await login.login()
  })
})
