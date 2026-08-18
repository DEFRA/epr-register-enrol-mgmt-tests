import { browser, $, expect } from '@wdio/globals'

import LoginPage from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * Auth flows (logout + stub nation selection).
 *
 * Login-to-work-items redirect is already covered by home.e2e.js
 * (RA-326 root redirect). This spec covers the remaining auth surface:
 *   1. /auth/logout clears the session (RA-449: landing on the "signed out"
 *      interstitial rather than login directly — see login.logout()), so a
 *      protected page (/work-items) bounces back to the Stub Login page.
 *   2. The stub login chooser (/auth/stub/login) builds a user with an
 *      optional nation, lands on the work items list authenticated, and
 *      produces the expected UI on a work item detail page. RA-323: every
 *      caseworker holds the same role, so there is no role selection any
 *      more — the assign-to-anyone picker and self-assign shortcut are
 *      both always available.
 */
describe('Auth flows', () => {
  describe('logout', () => {
    before(async () => {
      await LoginPage.login()
    })

    it('lands authenticated on the work items list with a Sign out link', async () => {
      await expect(browser).toHaveTitle('Applications', { containing: true })
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

  describe('stub nation selection', () => {
    afterEach(async () => {
      await LoginPage.logout()
    })

    it('an England-scoped user lands on the work items list and sees both assignment affordances', async () => {
      await LoginPage.login('England')

      await expect(browser).toHaveTitle('Applications', { containing: true })
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

      // RA-323: every caseworker sees both the self-assign shortcut and the
      // reassign affordance on an unassigned item. RA-295 moved the assignee
      // picker onto an interstitial, so the panel now offers a link rather
      // than the <select> this used to assert on.
      expect(await detail.hasAssignmentControl('selfAssign')).toBe(true)
      expect(await detail.hasAssignmentControl('reassign')).toBe(true)
    })

    it('a Wales-scoped user sees both assignment affordances on a work item', async () => {
      await LoginPage.login('Wales')

      await expect(browser).toHaveTitle('Applications', { containing: true })
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

      // All three affordances, per RA-295's AC03 matrix: reassign and unassign
      // are unconditional, and self-assign shows because this user does not
      // already hold the item.
      for (const control of ['selfAssign', 'reassign', 'unassign']) {
        expect(await detail.hasAssignmentControl(control)).toBe(true)
      }
    })
  })
})
