import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-254: the full operator payload, rendered for a regulator.
 *
 * The other re-accreditation e2e specs use work items created via the case
 * management "Create work item" form, which only populates a small subset of
 * fields (organisation name, site address, material, tonnage band). That
 * subset never exercises submittedBy, prns.authorisers, businessPlan,
 * samplingPlan.files or overseasSites.besEvidence — so a regression that drops
 * one of those fields between the operator payload and the UI would go
 * unnoticed. This targets the "full-payload-verification" seed item
 * (ReAccreditationSeeder), the only work item carrying every field a real
 * operator submission can send.
 *
 * RA-295 MIGRATION. These assertions used to run against a separate page at
 * /work-items/{id}/application-details. AC02 folded that page into the work
 * item detail page and retired the route (it now redirects), so everything
 * here moved onto the detail page.
 *
 * The coverage is deliberately PRESERVED rather than deleted along with the
 * page it used to test. This is the only spec proving that a rich operator
 * submission renders in full, and dropping it would have been a real loss of
 * coverage disguised as a migration. Where the data now lives:
 *   - headline identity            -> the case header
 *   - submitted application data   -> the `application-details` rows
 *   - identifiers and declaration  -> the retained reference block at the foot
 *     of the page, which OMITS valueless rows rather than rendering an em dash
 *
 * RA-319 fast-follow: the BES-evidence block below is the coverage flagged as
 * missing in mgmt-tests#62 (management-fe#117 shipped the BES-evidence UI with
 * only unit tests).
 */
describe('Full operator payload on the work item detail page (seeded)', () => {
  before(async () => {
    await login.login()
    // RA-299: a bare landing defaults to assigned-to-me, which would hide this
    // (unassigned) seeded item from the search — reset to an explicit empty
    // filter first so the search is not implicitly assignee-scoped.
    await workItems.resetFilters()
    await workItems.searchByOrgName('Full Payload Verification Ltd')
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('filtersApplied=1'),
      { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
    )
    // Hard gate: the search must resolve to exactly the one seeded item, so
    // "the first row" is unambiguous.
    expect(await workItems.getRowCount()).toBe(1)
    await workItems.openFirstListedWorkItem()
  })

  after(async () => {
    await login.logout()
  })

  describe('headline identity in the case header', () => {
    it('shows the organisation name and ID', async () => {
      await expect(detail.caseHeaderField('orgName')).toHaveText(
        expect.stringContaining('Full Payload Verification Ltd')
      )
      await expect(detail.caseHeaderField('orgId')).toHaveText(
        expect.stringContaining('org-full-payload-001')
      )
    })

    it('shows the registration number and material', async () => {
      await expect(detail.caseHeaderField('registrationNumber')).toHaveText(
        expect.stringContaining('EPR-100999')
      )
      await expect(detail.caseHeaderField('material')).toHaveText(
        expect.stringContaining('Plastic')
      )
    })
  })

  describe('identifiers in the retained reference block', () => {
    // Debugging identifiers rather than case-working data, which is why RA-295
    // moved them to the foot of the page instead of the header.
    const rows = [
      ['operator-application-id', 'app-full-payload-001'],
      ['operator-organisation-id', 'org-full-payload-001'],
      ['operator-registration-id', 'reg-full-payload-001'],
      ['operator-email', 'full.payload@example.com'],
      ['registration-number', 'EPR-100999'],
      ['accreditation-year', '2026'],
      ['previous-accreditation-year', '2025']
    ]

    for (const [key, value] of rows) {
      it(`shows ${key} as ${value}`, async () => {
        expect(await detail.hasReferenceRow(key)).toBe(true)
        await expect(detail.referenceRow(key)).toHaveText(
          expect.stringContaining(value)
        )
      })
    }

    it('shows the submitted-by declaration in full', async () => {
      // The three submittedBy fields are joined into one Declaration row.
      // Asserting all three guards against a partial mapping that silently
      // drops the job title or email while still rendering something plausible.
      expect(await detail.hasReferenceRow('declaration')).toBe(true)
      const declaration = await detail.referenceRowText('declaration')
      expect(declaration).toContain('Priya Sharma')
      expect(declaration).toContain('Compliance Manager')
      expect(declaration).toContain('priya.sharma@example.com')
    })
  })

  describe('submitted application data', () => {
    it('shows the site address', async () => {
      // RA-447 (CM2): the Application summary tab's site-address row now
      // always falls back to the registered address for an exporter
      // (wasteProcessingType: 'exporter'), matching the Additional
      // information tab's existing rule — even though this fixture also
      // carries its own siteAddress ("1 Full Payload Lane"), that value is
      // now intentionally ignored in favour of the registered address.
      const address = await detail.applicationDetailRowText('site-address')
      expect(address).toContain('100 Registered Office Road')
      expect(address).toContain('EC1A 1AB')
    })

    it('shows the planned PRN tonnage band', async () => {
      await expect(detail.applicationDetailRow('prn-tonnage')).toBeDisplayed()
    })

    it('shows the PRN authoriser by name', async () => {
      // Names only, by design: "PRN authorisers" answers who they are, and
      // "Authority to issue" below carries the contact detail. I originally
      // asserted the email here too, carried over from the retired page's
      // name+email table — but nothing is lost, it just moved rows.
      await expect(detail.applicationDetailRow('prn-authorisers')).toHaveText(
        expect.stringContaining('Tom Baker')
      )
    })

    it('shows the authoriser contact detail under "Authority to issue"', async () => {
      // Rendered as "Name (email)". Asserting the email specifically is the
      // point: it is the only place the submitted authoriser contact appears,
      // so if this row regressed to names-only the address would be nowhere on
      // the page and no other test would notice.
      const authority =
        await detail.applicationDetailRowText('authority-to-issue')
      expect(authority).toContain('Tom Baker')
      expect(authority).toContain('tom.baker@example.com')
    })

    it('shows every business plan category with its detail text', async () => {
      // The seeded business plan populates all six categories. Asserting each
      // catches a template that renders only the first, or that drops the
      // free-text detail while keeping the percentages.
      const businessPlan =
        await detail.applicationDetailRowText('business-plan')
      for (const text of [
        'New sorting line investment',
        'Subsidised collection scheme',
        'Kerbside collection expansion',
        'Customer awareness campaign',
        'New export contracts secured',
        'Recycled content packaging trial'
      ]) {
        expect(businessPlan).toContain(text)
      }
    })
  })

  describe('sampling and inspection plan documents', () => {
    it('lists every uploaded file with its upload metadata', async () => {
      // No "Clean" tag is expected: a clean file renders as a plain download
      // link, and the scan tag appears only for files that are NOT clean
      // (which then render as an unlinked span). Asserting "Clean" here — as I
      // first did, carried over from the retired page's scan-status column —
      // would have demanded a tag the design deliberately omits.
      const documents = await detail.supportingDocumentNames()
      expect(documents).toContain('sampling-plan.pdf')
      expect(documents).toContain('sampling-plan-appendix.pdf')
      const row = await detail.applicationDetailRowText(
        'sampling-inspection-plan'
      )
      expect(row).toContain('Updated 1 June 2026')
    })

    it('every listed document downloads the real file', async () => {
      // Fetched from inside the browser session so the session cookie carries
      // over and the URL resolves against whatever host this environment uses
      // (docker network name in CI, localhost locally, the deployed host on
      // BrowserStack). Proves the links resolve to real objects, not just that
      // the hrefs are shaped correctly.
      const responses = await detail.fetchSupportingDocumentResponses()
      expect(responses.length).toBeGreaterThan(0)
      for (const response of responses) {
        expect(response.status).toBe(200)
        expect(response.contentType).toContain('application/pdf')
      }
    })

    it('retains the "updated by" metadata', async () => {
      await expect(detail.samplingPlanUpdatedBy()).toBeDisplayed()
    })
  })

  describe('overseas site and BES evidence', () => {
    // This fixture carries overseasSites, which is the proxy management-fe
    // gates the Exporter-only sections on — there is no real Exporter
    // discriminator in the payload (see ra-295-application-details.e2e.js).
    it('shows the overseas site name and address', async () => {
      const ors = await detail.applicationDetailRowText('ors')
      expect(ors).toContain('Full Payload Verification Overseas Site')
      expect(ors).toContain('Rotterdam')
    })

    it('lists the BES evidence file', async () => {
      await expect(detail.applicationDetailRow('bes')).toHaveText(
        expect.stringContaining('bes-evidence.pdf')
      )
    })

    it('gives the BES evidence file a link that resolves to the real file', async () => {
      // The RA-319 fast-follow coverage this file's header promises. Listing
      // the filename only proves the loop ran; `download-file.controller.js`
      // reaches BES files through a SEPARATE
      // `overseasSites.sites[].besEvidence.files` lookup from the sampling-plan
      // branch, so nothing else in the suite exercises it. Without this the
      // `epr-register-enrol-bes-evidence` localstack fixture is seeded and
      // never fetched.
      const responses = await detail.fetchSupportingDocumentResponses('bes')
      expect(responses.length).toBeGreaterThan(0)
      for (const response of responses) {
        expect(response.status).toBe(200)
        expect(response.contentType).toContain('application/pdf')
      }
    })
  })

  describe('the retired two-step journey', () => {
    it('no longer shows the "View full application details" link', async () => {
      await expect(detail.viewApplicationDetailsLink()).not.toBeExisting()
    })
  })
})
