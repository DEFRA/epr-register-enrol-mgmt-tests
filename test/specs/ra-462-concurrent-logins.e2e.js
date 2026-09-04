import { browser, expect, $ } from '@wdio/globals'

import login from '../page-objects/login.page.js'

/**
 * RA-462 — Concurrent logins are allowed; a second sign-in for the same
 * caseworker identity does NOT end the first session, it notifies both.
 *
 *  - the session already active gets an "alert" toast
 *  - the session that just signed in gets an "info" toast
 *  - dismissing keeps it dismissed until a newer sign-in
 *  - both sessions stay usable (no redirect to /auth/regulator/login)
 *
 * The concurrency sibling of RA-306 (ra-306-sign-out.e2e.js): RA-306 proves
 * an explicit sign-out kills the session; this proves a second login does not.
 *
 * Single Chrome instance -> two cookie jars in one run.
 */

const NOTICE = '[data-testid="session-notice"]'

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

  it('shows the info toast on the session that just signed in', async () => {
    await expect($(`${NOTICE}[data-variant="info"]`)).toBeDisplayed()
  })

  it('shows the alert toast on the older session, which stays signed in', async () => {
    await browser.deleteCookies()
    await browser.setCookies(jarA)
    await browser.url('/work-items')

    expect(await login.hasAuthenticatedNav()).toBe(true)
    await expect($(`${NOTICE}[data-variant="alert"]`)).toBeDisplayed()
    await expect($('[data-testid="session-notice-signout"]')).toBeDisplayed()
  })

  it('keeps the alert dismissed until a still-newer sign-in', async () => {
    await browser.deleteCookies()
    await browser.setCookies(jarA)
    await browser.url('/work-items')
    await $('[data-testid="session-notice-dismiss"]').click()
    await expect($(NOTICE)).not.toBeExisting()

    await browser.url('/work-items')
    await expect($(NOTICE)).not.toBeExisting()

    await browser.reloadSession()
    await login.login()
    await browser.deleteCookies()
    await browser.setCookies(jarA)
    await browser.url('/work-items')
    await expect($(`${NOTICE}[data-variant="alert"]`)).toBeDisplayed()
  })
})
