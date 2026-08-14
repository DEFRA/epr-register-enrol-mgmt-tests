import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { LEGACY_ORG_NAME } from '../support/ra-292-seed.js'

/**
 * RA-292 backwards compatibility.
 *
 * Every work item submitted before this story carries none of `isNewSite` or
 * `isNew` — and the pre-RA-292 seed items carry no `overseasSites` and no
 * `prns` at all. The new template code reaches into nested site objects that
 * simply are not there on those items.
 *
 * Nunjucks does not throw on a missing key, which is what makes this worth a
 * spec rather than a code read: the regression ships as a page that renders,
 * returns 200, and looks fine to a smoke test, while showing a regulator
 * `[object Object]` where a town should be, or a "New" badge on a case from
 * two years ago.
 *
 * This runs against a SEPARATE work item and so needs its own describe block
 * with its own navigation.
 *
 * Split into its own file (originally part of ra-292-new-flags.e2e.js) so
 * wdio can schedule it on a separate worker rather than after the larger
 * AC01/02/03 block in the same process.
 */
describe('RA-292: a pre-RA-292 work item still renders cleanly', () => {
  before(async () => {
    await login.login()
    await workItems.resetFilters()
    await workItems.searchByOrgName(LEGACY_ORG_NAME)
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('filtersApplied=1'),
      { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
    )
    expect(await workItems.getRowCount()).toBe(1)
    await workItems.openFirstListedWorkItem()
  })

  after(async () => {
    await login.logout()
  })

  it('loads the overview page without erroring', async () => {
    await expect(detail.applicationDetails()).toBeDisplayed()
    await expect(detail.caseHeaderField('orgName')).toHaveText(
      expect.stringContaining(LEGACY_ORG_NAME)
    )
  })

  it('marks nothing on the page as new', async () => {
    expect(await detail.hasAnyNewTag()).toBe(false)
  })

  it('renders no ORS block and no interim block', async () => {
    // The ORS section is gated on the item having overseas sites, so on a
    // Reprocessor item the row is absent rather than empty. Interim sites are
    // nested inside ORS blocks and therefore cannot appear without one.
    expect(await detail.flaggedBlockCount('overseasSite')).toBe(0)
    expect(await detail.flaggedBlockCount('interimSite')).toBe(0)
  })

  it('renders no stray or half-built authority-to-issue contact', async () => {
    // The authority-to-issue row is ungated and renders an em dash when there
    // are no authorisers. What must NOT happen is an empty contact block: a
    // `{% for %}` over a missing `prns.authorisers` yields nothing, but a
    // template that renders one block unconditionally and fills it from
    // `authorisers[0]` produces a nameless, emailless contact.
    expect(await detail.flaggedBlockCount('authorityToIssueContact')).toBe(0)
  })

  it('renders no value as [object Object] or undefined', async () => {
    // The specific failure mode of the change under test: new template code
    // reaching into nested objects that a legacy payload does not have.
    await detail.assertNoUnrenderedValues()
  })

  it('keeps the pre-existing application information rows intact', async () => {
    // RA-292 edits a template that many other journeys read. The row keys the
    // AC does not touch must be untouched.
    for (const key of ['site-address', 'type', 'material', 'prn-tonnage']) {
      expect(await detail.hasApplicationDetailRow(key)).toBe(true)
    }
  })
})
