import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail, {
  APPLICATION_DETAIL_ROWS,
  EXPORTER_ONLY_ROWS
} from '../page-objects/work-item-detail.page.js'

/**
 * RA-295 (AC02) — all application data on a single page, in a consistent
 * order.
 *
 * Before RA-295 the detail page showed a summary and linked out to a separate
 * /application-details page for the submitted data. AC02 folds that second
 * page into the first: every field the operator submitted is shown on the work
 * item page itself, in the order the AC prescribes, and the "View full
 * application details" link is removed.
 *
 * Run against the seeded "Full Payload Verification Ltd" re-accreditation
 * item, which is the only fixture carrying the whole payload — PRN tonnage and
 * authorisers, a sampling & inspection plan, a business plan, and overseas
 * site / BES evidence. That last part matters for the negative test: the item
 * HAS overseas + BES data in its payload but is a Reprocessor, so those two
 * sections must still not render. A fixture without the data could not tell
 * "correctly hidden" apart from "nothing to show".
 */
describe('RA-295 application details on a single page', () => {
  before(async () => {
    await login.login()
    await workItems.resetFilters()
    await workItems.searchByOrgName('Full Payload Verification Ltd')
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

  it('shows the application information section on the work item page itself', async () => {
    await expect(detail.applicationDetails()).toBeDisplayed()
  })

  it('no longer offers a "View full application details" link', async () => {
    // The two-step journey is gone, so the link that started it must be too.
    await expect(detail.viewApplicationDetailsLink()).not.toBeExisting()
  })

  it('shows every non-Exporter field the AC prescribes', async () => {
    // Reported as one aggregate assertion so a failure names every missing
    // row at once, rather than stopping at the first and hiding the rest.
    const expectedRows = APPLICATION_DETAIL_ROWS.filter(
      (row) => !EXPORTER_ONLY_ROWS.includes(row)
    )
    const missing = []
    for (const row of expectedRows) {
      if (!(await detail.hasApplicationDetailRow(row))) {
        missing.push(row)
      }
    }
    expect(missing).toEqual([])
  })

  it('shows the fields in the order the AC prescribes', async () => {
    const rendered = await detail.applicationDetailRowOrder()
    // Compare against the canonical order narrowed to the rows actually
    // rendered. This asserts RELATIVE order — which is what the AC is about —
    // without failing over the Exporter-only rows that are legitimately absent
    // for this Reprocessor fixture.
    const expected = APPLICATION_DETAIL_ROWS.filter((row) =>
      rendered.includes(row)
    )
    expect(rendered).toEqual(expected)
  })

  it('carries submitted data in each field, not just the labels', async () => {
    // A section that renders its heading and an em dash would satisfy a
    // presence-only check while showing the caseworker nothing. Spot-check the
    // fields whose values come straight from the seeded payload.
    await expect(detail.applicationDetailRow('site-address')).toHaveText(
      expect.stringContaining('1 Full Payload Lane')
    )
    await expect(detail.applicationDetailRow('material')).toHaveText(
      expect.stringContaining('Plastic')
    )
    await expect(detail.applicationDetailRow('prn-authorisers')).toHaveText(
      expect.stringContaining('Tom Baker')
    )
    await expect(detail.applicationDetailRow('business-plan')).toHaveText(
      expect.stringContaining('New sorting line investment')
    )
  })

  it('lists every supporting document, not only the first', async () => {
    // The AC calls out that the sampling & inspection plan "could have other
    // supporting docs and should be listed". Asserting only that the first
    // filename appears would pass against a template rendering files[0] and
    // stopping — which is exactly the regression this guards.
    const documents = await detail.supportingDocumentNames()
    expect(documents.length).toBeGreaterThan(1)
    expect(documents).toContain('sampling-plan.pdf')
    expect(documents).toContain('sampling-plan-appendix.pdf')
  })

  it('retains the sampling & inspection plan "updated by" metadata', async () => {
    // Explicitly retained by the Jira notes, so it needs a guard of its own —
    // it is the sort of detail that quietly disappears in a layout rewrite.
    await expect(detail.samplingPlanUpdatedBy()).toBeDisplayed()
  })

  describe('Exporter-only sections on a Reprocessor application', () => {
    it('does not show Broadly Equivalent Standards or the Overseas Reprocessing Site', async () => {
      // AC02 items 9 and 10 are conditional on application type = Exporter.
      // This fixture is a Reprocessor (re-accreditation) that nonetheless
      // carries overseasSites and besEvidence in its payload, so a template
      // that renders those sections whenever the data is present — rather than
      // when the type warrants it — fails here.
      const rendered = []
      for (const row of EXPORTER_ONLY_ROWS) {
        if (await detail.hasApplicationDetailRow(row)) {
          rendered.push(row)
        }
      }
      expect(rendered).toEqual([])
    })
  })
})
