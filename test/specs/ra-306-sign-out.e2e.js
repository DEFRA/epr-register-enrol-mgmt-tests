import { browser, expect } from '@wdio/globals'

import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-306 — CM: Sign out of the service.
 *
 * A Regulator must be able to end their case-management session from the
 * service nav, and once they have, nothing they could previously see may still
 * be reachable — not by retyping the URL, and not with the browser back
 * button.
 *
 * What management-fe changes for this story:
 *   - the logout controller destroys the whole session (`yar.reset()`) rather
 *     than dropping the `user` key out of a surviving session, so no fragment
 *     of the old session can be resurrected;
 *   - authenticated page responses carry `Cache-Control: no-store`, which is
 *     what makes AC03 testable at all — without it the back button can serve
 *     the previously rendered page straight out of the HTTP cache and the
 *     server never gets a say.
 *
 * IMPORTANT — only AC03 below discriminates on this story's change. Run
 * against a pre-RA-306 build, AC01 and AC02 still pass and only AC03 fails
 * (verified against management-fe:latest while writing this). That is not a
 * gap in these specs: the old `yar.clear('user')` already removed the `user`
 * key the auth scheme reads, so the redirect-to-sign-in behaviour predates the
 * story, and what `yar.reset()` adds on top — destroying the rest of the
 * session (RA-299 filter state, in-flight OAuth state) and discarding the
 * session id so a captured cookie stops being a valid handle — is not
 * observable through the UI at all. It is pinned by unit tests in
 * management-fe's `src/server/routes/auth/controller.test.js`, which assert
 * `reset()` is called and `clear()` is not.
 *
 * So: AC01 and AC02 here are non-regression coverage, and a green AC01/AC02 is
 * NOT evidence that sign-out is correctly implemented. If AC03 ever passes on
 * a build with the `no-store` extension unwired, this spec has stopped testing
 * anything — treat that as a failure, not a pass.
 *
 * Deliberately NOT asserted here, because it would encode behaviour the story
 * does not deliver and the spec would fail:
 *   - federated/Entra sign-out. Only the local service session is destroyed;
 *     Entra's own SSO cookie survives, so a user who signs back in is NOT
 *     re-prompted for credentials.
 *   - pages held in the browser's in-memory bfcache. `no-store` disables
 *     bfcache for the page in Chrome, but a bfcache hit is a client-side
 *     concern with no server-side remedy, so it is out of scope rather than
 *     something to assert against.
 *   - inactivity timeout, server-side release of held work items, a "You have
 *     signed out" confirmation page, and moving /auth/logout from GET to POST.
 *     All out of scope for RA-306.
 *
 * Each AC gets its own signed-in session rather than chaining off the previous
 * test. AC03 depends on an exact browser-history shape (detail page, then
 * sign-out, then back), so letting AC02's URL probing land in the same history
 * stack would quietly change what `browser.back()` steps onto and stop the
 * test proving the AC.
 */
describe('RA-306 sign out of the service', () => {
  let workItemPath

  /**
   * One work item, created once, reused as "a page the user could previously
   * see" by both negative tests. Creating it per-AC would triple the setup
   * cost for no extra coverage — the ACs are about the session, not the item.
   */
  before(async () => {
    await login.login()
    await workItems.goto()
    const { id } = await workItems.createWorkItem({
      organisationName: 'Sign Out Ltd',
      siteAddressLine1: '1 Session Street',
      siteAddressTown: 'London',
      siteAddressPostcode: 'SW1A 3AA',
      material: 'plastic',
      tonnageBand: '0-500'
    })
    workItemPath = `/work-items/${id}`
  })

  after(async () => {
    // Leave the browser signed out: the session outlives this spec file, so a
    // spec that runs after this one must not inherit a half-authenticated
    // state from whichever AC happened to finish last.
    await login.logout()
  })

  describe('AC01 successful sign out', () => {
    before(async () => {
      await login.logout()
      await login.login()
      await workItems.goto()
    })

    it('ends the session and redirects to the sign-in page', async () => {
      // Prove the starting state is genuinely authenticated, otherwise a
      // broken login would make the assertions below pass for the wrong
      // reason.
      expect(await login.hasAuthenticatedNav()).toBe(true)

      await login.signOutViaNav()

      // waitForSignInPage() has already asserted the heading and the /auth
      // path; what is left is that the page carries no session-bearing
      // furniture at all.
      expect(await login.hasAuthenticatedNav()).toBe(false)
    })

    it('leaves a protected page unreachable, so the session really is gone', async () => {
      // The redirect above could in principle be cosmetic. Re-requesting the
      // list is what proves the session was terminated server-side rather
      // than the user merely being moved off the page.
      await browser.url('/work-items')
      await login.waitForSignInPage()
    })
  })

  describe('AC02 prevent access after sign out', () => {
    before(async () => {
      await login.logout()
      await login.login()
      await browser.url(workItemPath)
      await detail.waitForDetailUrl()
      // The detail page must genuinely have rendered while signed in — that is
      // the content AC02 says must become unreachable. `toBeDisplayed` waits,
      // where the boolean `hasCaseHeader()` used in the assertions below does
      // not, so use it here where we are waiting for a page to appear.
      await expect(detail.caseHeader()).toBeDisplayed()
      await login.signOutViaNav()
    })

    it('redirects a direct visit to the work item detail URL to sign-in', async () => {
      await browser.url(workItemPath)
      await login.waitForSignInPage()

      // Not just "some other page": specifically, none of the case content is
      // rendered.
      expect(await detail.hasCaseHeader()).toBe(false)
      expect(await login.hasAuthenticatedNav()).toBe(false)
    })

    it('redirects a direct visit to the previously opened list page to sign-in', async () => {
      await browser.url('/work-items')
      await login.waitForSignInPage()

      expect(await login.hasAuthenticatedNav()).toBe(false)
    })
  })

  describe('AC03 browser back button after sign out', () => {
    before(async () => {
      await login.logout()
      await login.login()
      await browser.url(workItemPath)
      await detail.waitForDetailUrl()
      await expect(detail.caseHeader()).toBeDisplayed()
      // Signing out via the nav (rather than a direct GET of /auth/logout)
      // keeps the history stack realistic: the entry immediately behind the
      // sign-in page is the detail page the user was reading.
      await login.signOutViaNav()
    })

    it('does not show the previously rendered work item when going back', async () => {
      await browser.back()

      // `no-store` forces the back navigation to refetch, so the server gets
      // to reject the now-dead session and redirect. If the response were
      // cacheable the old HTML would repaint here and this would fail.
      await login.waitForSignInPage()

      expect(await detail.hasCaseHeader()).toBe(false)
      expect(await login.hasAuthenticatedNav()).toBe(false)
    })
  })
})
