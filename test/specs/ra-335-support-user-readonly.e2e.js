import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-335 — Support users get a read-only view.
 *
 * Support users (Waste.SupportUser.ReadOnly Entra ID role) can sign in to
 * see the same case data a caseworker sees, but every action that would
 * modify a work item must render disabled rather than being hidden, and
 * any attempt to submit one anyway must be rejected. They also get a
 * "Backend status" nav link + page that is otherwise not shown at all.
 *
 * Enforcement is entirely in this frontend app (per architectural
 * decision — the .NET backend does not implement RBAC), so this spec
 * checks both layers: the UI control is disabled, AND a direct POST to
 * the underlying route is rejected even if a disabled control were
 * bypassed.
 */
describe('RA-335 Support user read-only view', () => {
  let workItemId

  before(async () => {
    // Seed a work item as a caseworker — support users cannot create one.
    await login.login()
    await workItems.goto()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'Support Readonly Ltd',
      siteAddressLine1: '1 Support Street',
      siteAddressTown: 'London',
      siteAddressPostcode: 'SW1A 1SU',
      material: 'plastic',
      tonnageBand: '0-500'
    }))
    await login.logout()
  })

  describe('sign-in', () => {
    afterEach(async () => {
      await login.logout()
    })

    it('lands authenticated on the work items list', async () => {
      await login.loginAsSupportUser()

      await expect(browser).toHaveTitle('Applications', { containing: true })
      await expect($('a[href="/auth/logout"]')).toBeDisplayed()
    })

    it('sees the same application data as a caseworker', async () => {
      await login.loginAsSupportUser()
      await workItems.openWorkItem(workItemId)

      expect(await detail.caseHeaderFieldText('orgName')).toEqual(
        expect.stringContaining('Support Readonly Ltd')
      )
    })
  })

  describe('modifying controls render disabled, not hidden', () => {
    before(async () => {
      await login.loginAsSupportUser()
      await workItems.openWorkItem(workItemId)
    })

    after(async () => {
      await login.logout()
    })

    it('shows the self-assign, reassign and unassign controls, all disabled', async () => {
      for (const control of ['selfAssign', 'reassign', 'unassign']) {
        expect(await detail.hasAssignmentControl(control)).toBe(true)
        await expect(detail.assignmentControl(control)).not.toBeEnabled()
      }
    })

    it('shows the Query control, disabled', async () => {
      const query = $('[data-testid="action-query"]')
      await expect(query).toBeExisting()
      await expect(query).not.toBeEnabled()
    })
  })

  describe('a modifying request is still rejected server-side', () => {
    afterEach(async () => {
      await login.logout()
    })

    // Defence in depth: even if a disabled UI control were bypassed (a
    // crafted request, a stale form), the underlying route itself must
    // reject a support user — this is what actually satisfies "any
    // attempt to submit modification data should result in an error",
    // not just the UI disabling.
    it('rejects a direct self-assign POST with 403', async () => {
      await login.loginAsSupportUser()
      await workItems.openWorkItem(workItemId)

      // The crumb cookie is HttpOnly (by design — it must not be readable
      // by third-party script), so read the token from the hidden form
      // field the page already rendered instead. `fetch` sends cookies
      // automatically for a same-origin request, so the browser attaches
      // the crumb cookie itself.
      const status = await browser.execute(async (id) => {
        const crumbValue = document.querySelector('input[name="crumb"]')?.value
        const res = await fetch(`/work-items/${id}/self-assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `crumb=${crumbValue}`
        })
        return res.status
      }, workItemId)

      expect(status).toBe(403)
    })
  })

  describe('backend status', () => {
    it('is not visible or reachable for a signed-out visitor', async () => {
      await expect($('[data-testid="nav-backend-status"]')).not.toExist()

      await browser.url('/backend-status')
      // Signed-out visitors get bounced to login, same as any other
      // protected route.
      await expect($('h1=Stub Login')).toBeDisplayed()
    })

    it('is not visible or reachable for a caseworker', async () => {
      await login.login()

      await expect($('[data-testid="nav-backend-status"]')).not.toExist()

      await browser.url('/backend-status')
      await expect($('h1=403')).toBeDisplayed()

      await login.logout()
    })

    it('is visible and reachable for a support user', async () => {
      await login.loginAsSupportUser()

      const link = $('[data-testid="nav-backend-status"]')
      await expect(link).toBeDisplayed()
      await link.click()

      await expect(browser).toHaveUrl(
        expect.stringContaining('/backend-status')
      )
      await expect($('body')).toHaveText(
        expect.stringContaining('Backend status')
      )

      await login.logout()
    })
  })
})
