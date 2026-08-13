import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import notFound from '../page-objects/work-item-not-found.page.js'
import { dulyMake } from '../support/re-accreditation-journey.js'

/**
 * Error pages.
 *
 * Covers the work-item error states that previously had no explicit e2e
 * assertions:
 *   1. GET /work-items/{unknownId} renders the 404 "not found" page
 *      (not-found.njk). RA-358 reworded that page, so the copy assertions
 *      moved into ra-358-withdrawn-work-item-message.e2e.js and this case now
 *      asserts only that the branch renders.
 *   2. The returnTo open-redirect guard (successRedirect) only honours the
 *      whitelisted "/work-items/{id}/tasks" path. A forged, non-whitelisted
 *      returnTo is ignored and the user falls back to the detail page rather
 *      than being redirected off-site.
 *
 * The 502 "Could not reach the backend" case (detail-error.njk) is asserted
 * via it.skip below — it requires taking the backend down / stubbing a
 * transport failure, which this e2e environment cannot do without bespoke
 * infra, so it is skipped rather than faked.
 */
describe('Error pages', () => {
  let workItemId

  before(async () => {
    // Seed a work item to operate on, mirroring the passing sibling specs
    // (assign-reassign-unassign / create-work-item-fields): log in as the
    // 'assign' role, then land on the work-items list before creating — the
    // create link lives on /work-items, not the post-login home page, so
    // createWorkItem() must be preceded by goto().
    await login.login()
    await workItems.goto()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'Error Page Test Ltd',
      siteAddressLine1: '1 Error Street',
      siteAddressTown: 'London',
      siteAddressPostcode: 'SW1A 1AD',
      material: 'plastic',
      tonnageBand: '0-500'
    }))

    // The fixture sits in `duly-made` because that is where a real
    // caller-invocable action (`payment-received`) is available to carry the
    // returnTo guard case below. This file is about the redirect guards, not
    // about which action carries them.
    await dulyMake(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('renders the 404 page for an unknown work item id', async () => {
    // RA-358 reworded this page: the heading is now "Application not found"
    // and the body no longer presents the raw id as the user-facing
    // identifier, so the old exact-copy assertions here have been replaced by
    // the shared page object. The RA-358 spec owns the detailed assertions
    // (application-terms wording, id not shown as the identifier); this case
    // keeps its original job of proving the 404 branch renders at all.
    //
    // The id used here is deliberately NOT a GUID, which is the whole point
    // of keeping it: it proves a malformed id still reaches the not-found
    // view rather than some upstream validation branch. RA-358's
    // "does not present a non-GUID id to the user either" case then pins the
    // identifier rule for this same shape, so the split is: this file proves
    // the routing, that file proves the copy.
    await workItems.openWorkItem('does-not-exist-00000000')
    await notFound.assertRendered()
  })

  it('ignores a forged returnTo (open-redirect guard) and falls back to the detail page', async () => {
    // RA-410 deleted the tasks page, and with it the only form that carried a
    // hidden `returnTo` field. TWO cases used to live here: a whitelisted
    // returnTo landing on /work-items/{id}/tasks, and a forged one being
    // rejected. The first is gone with its destination — there is no second
    // whitelisted target left to redirect to, so a test asserting one would be
    // asserting a route that does not exist.
    //
    // The GUARD itself survives (`successRedirect` in management-fe's
    // detail.controller.js) and is still reachable, so the security case is
    // kept and re-pointed at the generic apply-action route. That is a
    // STRONGER test than the one it replaces: the old version tampered with a
    // field the server had just rendered, whereas this forges the payload
    // outright, which is what an attacker actually does.
    await workItems.openWorkItem(workItemId)

    // The fixture sits in `duly-made`, where `payment-received` is a real
    // caller-invocable action — RA-410 ungated it. Using a genuine action
    // matters: the guard runs on the SUCCESS path, so an action that failed
    // would never reach it and the test could not fail.
    const forged = await browser.execute(async (id) => {
      const crumb = document.querySelector('input[name="crumb"]')?.value ?? ''
      const res = await fetch(`/work-items/${id}/actions/payment-received`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:
          `crumb=${encodeURIComponent(crumb)}` +
          `&returnTo=${encodeURIComponent('https://evil.example.com/phish')}`
      })
      return { status: res.status, url: res.url }
    }, workItemId)

    const finalUrl = new URL(forged.url)
    expect(finalUrl.host).not.toBe('evil.example.com')
    expect(finalUrl.pathname).toBe(`/work-items/${workItemId}`)
  })

  // 502 "Could not reach the backend" (detail-error.njk) needs the backend to
  // be unreachable (stopped/stubbed transport failure). That cannot be
  // triggered from the browser in this e2e environment without bespoke infra,
  // so it is skipped here rather than faked. Covered at unit level by the
  // management-fe controller tests.
  it.skip('renders the 502 page when the backend is unreachable', async () => {})
})
