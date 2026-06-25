import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * epr-9i8k — error pages.
 *
 * Covers the work-item error states that previously had no explicit e2e
 * assertions:
 *   1. GET /work-items/{unknownId} renders the 404 "not found" page with the
 *      copy "No work item exists with id {id}" (not-found.njk).
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
describe('epr-9i8k — error pages', () => {
  let workItemId

  before(async () => {
    await login.loginAs('standard')
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'Error Page Test Ltd',
      siteAddressLine1: '1 Error Street',
      siteAddressTown: 'London',
      siteAddressPostcode: 'SW1A 1AA',
      material: 'plastic',
      tonnageBand: '0-500'
    }))
  })

  after(async () => {
    await login.logout()
  })

  it('renders the 404 page for an unknown work item id', async () => {
    const unknownId = 'does-not-exist-00000000'
    await workItems.openWorkItem(unknownId)

    await expect($('h1')).toHaveText('Work item not found')

    const notFound = $('[data-testid="work-item-not-found"]')
    await expect(notFound).toBeDisplayed()
    await expect(notFound).toHaveText(
      expect.stringContaining('No work item exists with id')
    )
    await expect(notFound).toHaveText(expect.stringContaining(unknownId))
  })

  it('honours a whitelisted returnTo and redirects to the tasks page', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.gotoTasks()

    // The tasks form hardcodes returnTo to the whitelisted
    // "/work-items/{id}/tasks" path, so a successful status change must
    // PRG-redirect back to the tasks page.
    await detail.setTaskStatus('check-eligibility', 'InProgress')

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
        '[data-testid="task-status-select-check-eligibility"]'
      )
      const form = select && select.closest('form')
      const returnTo = form && form.querySelector('input[name="returnTo"]')
      if (!returnTo) {
        throw new Error('Could not find returnTo input on task status form')
      }
      returnTo.value = 'https://evil.example.com/phish'
    })

    await $(
      '[data-testid="task-status-select-check-eligibility"]'
    ).selectByAttribute('value', 'Blocked')
    await $('[data-testid="set-task-status-check-eligibility"]').click()

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
