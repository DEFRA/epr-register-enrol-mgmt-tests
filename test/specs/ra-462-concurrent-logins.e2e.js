import { browser, expect, $ } from '@wdio/globals'

import login from '../page-objects/login.page.js'

/**
 * RA-462 — Concurrent logins are allowed; a second sign-in for the same
 * caseworker identity does NOT end the first session, it notifies both.
 *
 * What this journey spec verifies:
 *  - the session that just signed in sees a "you are signed in elsewhere"
 *    notice
 *  - the session that was already active is NOT signed out
 *  - the notice can be dismissed
 *
 * The exact alert-vs-info variant, the "a newer sign-in was detected" wording
 * and dismissal persistence are covered by concurrent-login.test.js in
 * epr-register-enrol-management-fe. They are not re-asserted here: the journey
 * grid runs many parallel browsers as the SAME stub caseworker, so the
 * per-identity registry that drives the alert variant is churned continuously
 * by other specs and cannot be pinned from a single spec.
 *
 * The concurrency sibling of RA-306 (ra-306-sign-out.e2e.js): RA-306 proves
 * an explicit sign-out kills the session; this proves a second login does not.
 *
 * Single Chrome instance -> two cookie jars in one run.
 */

const NOTICE = '[data-testid="session-notice"]'
const WORK_ITEMS = '/work-items'

describe('RA-462 concurrent-login notification', () => {
  let jarA

  beforeEach(async () => {
    await login.login()
    jarA = await browser.getCookies()

    await browser.reloadSession()
    await login.login()
  })

  afterEach(async () => {
    await login.logout()
  })

  it('shows a session-notice on the session that just signed in', async () => {
    await expect($(NOTICE)).toBeDisplayed()
  })

  it('does not sign out the session that was already active', async () => {
    await browser.deleteCookies()
    await browser.setCookies(jarA)
    await browser.url(WORK_ITEMS)

    // The first session is still valid — not bounced to the login page, and
    // its authenticated chrome still renders.
    await expect(browser).not.toHaveUrl(
      expect.stringContaining('/auth/regulator/login')
    )
    expect(await login.hasAuthenticatedNav()).toBe(true)
  })

  it('dismissing the notice removes it', async () => {
    // Runs on the just-signed-in session, whose notice is a stable
    // session-flag render (not the churn-prone registry read).
    await expect($(NOTICE)).toBeDisplayed()
    await $('[data-testid="session-notice-dismiss"]').click()
    await expect($(NOTICE)).not.toBeDisplayed()
  })
})
