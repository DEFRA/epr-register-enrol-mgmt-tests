import { browser, $, expect } from '@wdio/globals'
import LoginPage from '../page-objects/login.page.js'

describe('RA-622 connected management access', () => {
  before(function () {
    if (process.env.RA_622_SPIKE_TESTS !== 'true') {
      this.skip()
    }
  })
  it('signs in normally and reads the real management worklist', async () => {
    await browser.deleteCookies()
    await LoginPage.login()
    expect(new URL(await browser.getUrl()).pathname).toBe('/work-items')
    await browser.url('/work-items?filtersApplied=1&assigneeMode=any')
    await expect($('[data-testid="applications-list"]')).toBeDisplayed()
    await expect($('[data-testid="application-tile"]')).toBeDisplayed()
    const cookies = await browser.getCookies()
    expect(
      cookies.some(
        (cookie) => cookie.name === 'ra-622-spike-management-session'
      )
    ).toBe(true)
    expect(
      cookies.some((cookie) => cookie.name === 'ra-622-spike-operator-session')
    ).toBe(false)
    await browser.refresh()
    expect(new URL(await browser.getUrl()).pathname).toBe('/work-items')
    await expect($('[data-testid="applications-list"]')).toBeDisplayed()
  })
})
