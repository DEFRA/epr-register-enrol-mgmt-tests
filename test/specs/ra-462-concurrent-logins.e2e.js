import { browser, expect, $ } from '@wdio/globals'

import login from '../page-objects/login.page.js'

/**
 * RA-462 — Concurrent logins are allowed; a second sign-in for the same
 * caseworker identity does NOT end the first session, it notifies both.
 *
 *  - the session that just signed in gets an "info" toast
 *  - the session already active gets an "alert" toast, and is not signed out
 *  - dismissing the toast removes it
 *
 * The concurrency sibling of RA-306 (ra-306-sign-out.e2e.js): RA-306 proves
 * an explicit sign-out kills the session; this proves a second login does not.
 *
 * Single Chrome instance -> two cookie jars in one run. The journey grid runs
 * many parallel browsers as the SAME stub caseworker, so the per-identity
 * registry that drives the "alert" is constantly churned by other specs. The
 * jar A alert is re-checked with a re-navigating wait, and dismissal
 * persistence across navigations is deliberately NOT asserted here (a
 * genuinely newer parallel sign-in re-raises it, correctly) — that is covered
 * by concurrent-login.test.js in epr-register-enrol-management-fe.
 */

const NOTICE = '[data-testid="session-notice"]'
const WORK_ITEMS = '/work-items'

async function restoreJar(jar) {
  await browser.deleteCookies()
  await browser.setCookies(jar)
}

async function loadUntilAlertShown(url) {
  await browser.waitUntil(
    async () => {
      await browser.url(url)
      return $(`${NOTICE}[data-variant="alert"]`).isDisplayed()
    },
    {
      timeout: 20000,
      interval: 1000,
      timeoutMsg: 'alert toast did not appear for the older (jar A) session'
    }
  )
}

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
    await restoreJar(jarA)
    await loadUntilAlertShown(WORK_ITEMS)

    expect(await login.hasAuthenticatedNav()).toBe(true)
    await expect($('[data-testid="session-notice-signout"]')).toBeDisplayed()
  })

  it('dismissing the alert removes it', async () => {
    await restoreJar(jarA)
    await loadUntilAlertShown(WORK_ITEMS)

    await $('[data-testid="session-notice-dismiss"]').click()
    await expect($(`${NOTICE}[data-variant="alert"]`)).not.toBeDisplayed()
  })
})
