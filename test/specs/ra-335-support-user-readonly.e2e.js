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
 * "Disabled" takes two shapes depending on the affordance: self-assign is
 * a real POST form/button, so it gets a native `disabled` attribute; the
 * navigational affordances (reassign, unassign, query, withdraw, approve,
 * create work item) are links with no native disabled state, so they
 * render as an inert `<span>` with no `href` instead — see
 * action-link/macro.njk in management-fe.
 *
 * Enforcement is entirely in this frontend app (per architectural
 * decision — the .NET backend does not implement RBAC), so this spec
 * checks both layers: the UI control is disabled/inert, AND a direct
 * POST to the underlying route is rejected even if that were bypassed.
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

    it('shows the self-assign control, disabled', async () => {
      // Self-assign is a real POST form/button, so it has a native
      // disabled state, unlike the link-based controls below.
      expect(await detail.hasAssignmentControl('selfAssign')).toBe(true)
      await expect(detail.assignmentControl('selfAssign')).not.toBeEnabled()
    })

    it('shows the reassign and unassign controls as inert (no href)', async () => {
      for (const control of ['reassign', 'unassign']) {
        expect(await detail.hasAssignmentControl(control)).toBe(true)
        const testId =
          control === 'reassign' ? 'reassign-link' : 'unassign-link'
        expect(await detail.isActionDisabled(testId)).toBe(true)
      }
    })

    it('shows the Query control as inert (no href)', async () => {
      const query = $('[data-testid="action-query"]')
      await expect(query).toBeExisting()
      expect(await detail.isActionDisabled('action-query')).toBe(true)
    })
  })

  describe('a modifying request is still rejected server-side', () => {
    afterEach(async () => {
      await login.logout()
    })

    // The crumb cookie is HttpOnly (by design — it must not be readable
    // by third-party script), so read the token from the hidden form
    // field the page already rendered instead. `fetch` sends cookies
    // automatically for a same-origin request, so the browser attaches
    // the crumb cookie itself. The scope check runs before the handler
    // ever looks at params/payload, so a placeholder taskId/actionId is
    // enough to prove rejection — this is about auth, not business logic.
    async function postAsSupportUser(url) {
      return browser.execute(async (u) => {
        const crumbValue = document.querySelector('input[name="crumb"]')?.value
        const res = await fetch(u, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `crumb=${crumbValue}`
        })
        return res.status
      }, url)
    }

    // Defence in depth: even if a disabled UI control were bypassed (a
    // crafted request, a stale form), the underlying route itself must
    // reject a support user — this is what actually satisfies "any
    // attempt to submit modification data should result in an error",
    // not just the UI disabling.
    it('rejects a direct self-assign POST with 403', async () => {
      await login.loginAsSupportUser()
      await workItems.openWorkItem(workItemId)

      const status = await postAsSupportUser(
        `/work-items/${workItemId}/self-assign`
      )

      expect(status).toBe(403)
    })

    // RA-335: these 5 routes had NO scope check at all before RA-335 —
    // any authenticated session, including a read-only support user,
    // could reach them. self-assign (above) already had requireStandard
    // beforehand, so it alone doesn't prove this fix; these do.
    const previouslyUngatedRoutes = [
      [
        'complete task',
        (id) => `/work-items/${id}/tasks/placeholder-task/complete`
      ],
      [
        'set task status',
        (id) => `/work-items/${id}/tasks/placeholder-task/status`
      ],
      ['apply action', (id) => `/work-items/${id}/actions/placeholder-action`],
      [
        'withdraw confirm',
        (id) => `/work-items/${id}/actions/withdraw/confirm`
      ],
      ['submit query', (id) => `/work-items/${id}/query`]
    ]

    for (const [name, urlFor] of previouslyUngatedRoutes) {
      it(`rejects a direct POST to the previously-ungated ${name} route with 403`, async () => {
        await login.loginAsSupportUser()
        await workItems.openWorkItem(workItemId)

        const status = await postAsSupportUser(urlFor(workItemId))

        expect(status).toBe(403)
      })
    }
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
