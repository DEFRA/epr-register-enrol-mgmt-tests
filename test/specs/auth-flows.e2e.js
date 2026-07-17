import { browser, $, expect } from '@wdio/globals'

import LoginPage from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'

/**
 * Auth flows (logout + stub role/nation selection).
 *
 * Login-to-work-items redirect is already covered by home.e2e.js
 * (RA-326 root redirect). This spec covers the remaining auth surface:
 *   1. /auth/logout clears the session and redirects to login, so a
 *      protected page (/work-items) bounces back to the Stub Login page.
 *   2. The stub login chooser (/auth/stub/login) builds a user from the
 *      selected role + nation, lands on the work items list authenticated,
 *      and produces the expected role-based UI on a work item detail page.
 */
describe('Auth flows', () => {
  describe('logout', () => {
    before(async () => {
      await LoginPage.loginAs('standard')
    })

    it('lands authenticated on the work items list with a Sign out link', async () => {
      await expect(browser).toHaveTitle('Work items', { containing: true })
      await expect($('a[href="/auth/logout"]')).toBeDisplayed()
    })

    it('clears the session so a protected page bounces to login', async () => {
      await LoginPage.logout()

      // With no session, the protected work-items list must 401 -> redirect
      // back to the stub login chooser rather than render the list.
      await browser.url('/work-items')
      await expect($('h1=Stub Login')).toBeDisplayed()
    })
  })

  describe('stub role and nation selection', () => {
    afterEach(async () => {
      await LoginPage.logout()
    })

    it('standard + England user lands on the work items list and can self-assign', async () => {
      await LoginPage.loginAs('standard', 'England')

      await expect(browser).toHaveTitle('Work items', { containing: true })
      await expect($('a[href="/auth/logout"]')).toBeDisplayed()

      await workItems.goto()
      const { id } = await workItems.createWorkItem({
        organisationName: 'Standard England Ltd',
        siteAddressLine1: '1 Standard Street',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AC',
        material: 'plastic',
        tonnageBand: '0-500'
      })
      await workItems.openWorkItem(id)

      // Standard role: self-assign control is shown, the assignee picker
      // (assign-anyone) is not.
      await expect($('[data-testid="self-assign-submit"]')).toBeDisplayed()
      await expect($('[data-testid="assign-select"]')).not.toBeExisting()
    })

    it('assign + Wales user sees the assignee picker on a work item', async () => {
      await LoginPage.loginAs('assign', 'Wales')

      await expect(browser).toHaveTitle('Work items', { containing: true })
      await expect($('a[href="/auth/logout"]')).toBeDisplayed()

      await workItems.goto()
      const { id } = await workItems.createWorkItem({
        organisationName: 'Assign Wales Ltd',
        siteAddressLine1: '2 Assign Street',
        siteAddressTown: 'Cardiff',
        siteAddressPostcode: 'CF10 1AA',
        material: 'plastic',
        tonnageBand: '0-500'
      })
      await workItems.openWorkItem(id)

      // Assign role: the assignee picker is shown, and self-assign is not.
      await expect($('[data-testid="assign-select"]')).toBeDisplayed()
      await expect($('[data-testid="assign-submit"]')).toBeDisplayed()
      await expect($('[data-testid="self-assign-submit"]')).not.toBeExisting()
    })
  })
})
