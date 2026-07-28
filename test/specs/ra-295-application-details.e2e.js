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
 * site / BES evidence.
 *
 * KNOWN LIMITATION on AC02 items 9 and 10 (BES / Overseas Reprocessing Site,
 * "only show if application type = Exporter"). There is no Exporter
 * discriminator anywhere in the stack: management-be confirmed that the
 * upstream ReEx `wasteProcessingType` is never written into the work item
 * payload and `typeId` is hard-coded "re-accreditation" for both operator
 * types, so no Exporter fixture exists or can exist in this story.
 * management-fe therefore gates the two sections on a non-empty
 * `overseasSites.sites[]` as an explicit PROXY for Exporter.
 *
 * That means these specs can only prove the proxy, not the AC: they assert the
 * sections appear when overseas data is present and are absent when it is not.
 * A genuine Exporter/Reprocessor test is impossible until the payload carries
 * the real discriminator — flagged to the lead as a follow-up, and called out
 * again on the negative test below so nobody mistakes it for full coverage.
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

  describe('the conditional BES / Overseas Reprocessing Site sections', () => {
    it('shows both sections for an application that has overseas site data', async () => {
      // Still on the full-payload fixture, which carries overseasSites with
      // BES evidence. Asserting the sections DO render here is what stops the
      // negative test below from passing vacuously against a build that simply
      // never renders them at all.
      const missing = []
      for (const row of EXPORTER_ONLY_ROWS) {
        if (!(await detail.hasApplicationDetailRow(row))) {
          missing.push(row)
        }
      }
      expect(missing).toEqual([])
    })

    describe('an application with no overseas site data', () => {
      // "Belfast Fibres Co" is a seeded re-accreditation item with no
      // overseasSites in its payload, and its org name is unique to the seed
      // data (no spec creates it), so the search resolves to exactly one row.
      //
      // NB this proves the PROXY described in the file header, not AC02's
      // actual "only if Exporter" rule — both fixtures are Reprocessors,
      // because no Exporter fixture can exist yet. Re-point this at a real
      // Exporter fixture once the payload carries the discriminator.
      before(async () => {
        await workItems.resetFilters()
        await workItems.searchByOrgName('Belfast Fibres Co')
        expect(await workItems.getRowCount()).toBe(1)
        await workItems.openFirstListedWorkItem()
      })

      it('hides Broadly Equivalent Standards and the Overseas Reprocessing Site', async () => {
        const rendered = []
        for (const row of EXPORTER_ONLY_ROWS) {
          if (await detail.hasApplicationDetailRow(row)) {
            rendered.push(row)
          }
        }
        expect(rendered).toEqual([])
      })

      it('still shows the rest of the application information', async () => {
        // Guards against the hiding being implemented by simply not rendering
        // the section at all on this page.
        await expect(detail.applicationDetails()).toBeDisplayed()
        expect(await detail.hasApplicationDetailRow('site-address')).toBe(true)
        expect(await detail.hasApplicationDetailRow('material')).toBe(true)
      })
    })
  })
})
