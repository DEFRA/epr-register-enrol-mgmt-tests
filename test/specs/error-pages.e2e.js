import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import notFound from '../page-objects/work-item-not-found.page.js'

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

  it('honours a whitelisted returnTo and redirects to the tasks page', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.gotoTasks()

    // The tasks form hardcodes returnTo to the whitelisted
    // "/work-items/{id}/tasks" path, so a successful status change must
    // PRG-redirect back to the tasks page.
    await detail.setTaskStatus('verify-organisation-details', 'InProgress')

    await browser.waitUntil(
      async () =>
        new URL(await browser.getUrl()).pathname ===
        `/work-items/${workItemId}/tasks`,
      {
        timeout: 10000,
        timeoutMsg: 'Expected whitelisted returnTo to land on the tasks page'
      }
    )
  })

  it('ignores a non-whitelisted returnTo (open-redirect guard) and falls back to the detail page', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.gotoTasks()

    // Tamper the hidden returnTo on the first task's status form to an
    // external URL, keeping the real crumb in place. The server-side guard
    // (successRedirect) must reject this and fall back to the detail page.
    await browser.execute(() => {
      const select = document.querySelector(
        '[data-testid="task-status-select-verify-organisation-details"]'
      )
      const form = select && select.closest('form')
      const returnTo = form && form.querySelector('input[name="returnTo"]')
      if (!returnTo) {
        throw new Error('Could not find returnTo input on task status form')
      }
      returnTo.value = 'https://evil.example.com/phish'
    })

    await $(
      '[data-testid="task-status-select-verify-organisation-details"]'
    ).selectByAttribute('value', 'Blocked')
    await $(
      '[data-testid="set-task-status-verify-organisation-details"]'
    ).click()

    await browser.waitUntil(
      async () =>
        new URL(await browser.getUrl()).pathname ===
        `/work-items/${workItemId}`,
      {
        timeout: 10000,
        timeoutMsg:
          'Expected forged returnTo to be ignored and fall back to the detail page'
      }
    )

    const finalUrl = new URL(await browser.getUrl())
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
