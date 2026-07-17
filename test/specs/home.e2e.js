import { browser, expect } from '@wdio/globals'

import LoginPage from '../page-objects/login.page.js'

/**
 * RA-326: there is no standalone home page any more. '/' exists only to
 * redirect old bookmarks/links somewhere useful — the work items list —
 * rather than 404ing.
 */
describe('Root redirect', () => {
  it('redirects an authenticated visitor from "/" to the work items list', async () => {
    await LoginPage.loginAs('standard')
    await browser.url('/')
    await expect(browser).toHaveTitle('Work items', { containing: true })
    await expect(new URL(await browser.getUrl()).pathname).toBe('/work-items')
  })
})
