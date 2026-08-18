import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail, {
  APPLICATION_DETAIL_ROWS,
  EXPORTER_ONLY_ROWS
} from '../page-objects/work-item-detail.page.js'
import { EXPORTER } from '../support/ra-434-seed.js'

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
 * AC02 items 9 and 10 (BES / Overseas Reprocessing Site, "only show if
 * application type = Exporter") gate on `payload.wasteProcessingType`
 * (RA-434-processortype's `isExporterApplication`) — the real Exporter
 * discriminator, not a proxy. This fixture's `wasteProcessingType` is seeded
 * as `"exporter"` alongside its `overseasSites` data specifically so this is
 * a genuine Exporter/Reprocessor test rather than a proxy for one: see
 * ReAccreditationSeeder's `full-payload-verification` item and its
 * RA-434-processortype comment. The negative test below (a reprocessor with
 * no overseas data) is the other half of the AC.
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

  it('gives every supporting document a link that resolves to the real file', async () => {
    // Listing a filename is not the same as linking it correctly. The second
    // and subsequent documents are exactly where an index-confused or
    // copy-pasted href hides — every link would render, and a names-only
    // assertion would be perfectly green while the appendix downloaded the
    // first file (or 404'd).
    const responses = await detail.fetchSupportingDocumentResponses()
    expect(responses.length).toBeGreaterThan(1)
    for (const response of responses) {
      expect(response.status).toBe(200)
      expect(response.contentType).toContain('application/pdf')
    }

    // Status and content-type are identical for both documents, so the checks
    // above cannot tell a correct link from one serving document one twice.
    // The two seeded objects have deliberately different bodies — that is the
    // only signal that discriminates, so assert on it.
    const hrefs = responses.map((r) => r.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    const bodies = responses.map((r) => r.body)
    expect(new Set(bodies).size).toBe(bodies.length)
    expect(bodies.some((b) => b.includes('appendix fixture content'))).toBe(
      true
    )
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
      // "Belfast Fibres Co" is a seeded re-accreditation item with neither
      // `wasteProcessingType` nor `overseasSites` in its payload — a genuine
      // Reprocessor, and the other half of the real Exporter/Reprocessor test
      // this describe block runs (see the file header) — and its org name is
      // unique to the seed data (no spec creates it), so the search resolves
      // to exactly one row.
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

  describe('RA-447 (CM2) — exporter Site address falls back to the registered address', () => {
    // Bug: buildApplicationSummary's site-address row called
    // buildSiteAddressLines(payload) with no exporter fallback, so an
    // exporter (which has no siteAddress in re-ex — only reprocessors do)
    // rendered an em dash here, even though the "Additional information" tab
    // already got this right (RA-434's deriveSiteAddress). The fix
    // consolidates both tabs onto the same fallback.
    //
    // Reuses RA-434's EXPORTER fixture ("Continental Exports Verification
    // Ltd", wasteProcessingType: exporter, no siteAddress at all) rather than
    // seeding a new item — it is exactly the CM2 bug scenario, and the
    // Additional information tab's own coverage of it lives in
    // ra-434-additional-information-tab.e2e.js.
    before(async () => {
      await login.login()
      await workItems.resetFilters()
      await workItems.searchByOrgName(EXPORTER.ORG_NAME)
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

    it('shows the Site address row rather than an em dash', async () => {
      expect(await detail.hasApplicationDetailRow('site-address')).toBe(true)
      const value = await detail.applicationDetailValue('site-address').getText()
      expect(value).not.toBe('—')
    })

    it('falls back to the registered address, matching the Additional information tab', async () => {
      const value = await detail.applicationDetailValue('site-address').getText()
      expect(value).toBe(EXPORTER.COMPANY_REGISTERED_ADDRESS)
    })
  })
})
