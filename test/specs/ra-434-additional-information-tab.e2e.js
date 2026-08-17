import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { REPROCESSOR, EXPORTER } from '../support/ra-434-seed.js'

/**
 * RA-434 — the "Additional information" tab.
 *
 * A third tab on the work item detail page, alongside "Application summary"
 * and "Application history" (RA-295), showing six rows sourced from the
 * operator's re-ex submission: Registered name, Companies house number,
 * Registered address, Site name, Site address, Permit numbers — in that
 * fixed order. Missing rows are OMITTED entirely (no em-dash placeholder),
 * matching the Application summary tab's reference-footer convention.
 *
 * Two fixtures cover the tab's one real conditional, the Site address
 * fallback: re-ex has no site for an exporter, so an exporter's Site address
 * row falls back to the registered address (matching OJ's own header); a
 * reprocessor (or a work item with no `wasteProcessingType` at all) keeps a
 * genuine site address. Site name has no producer field anywhere in the
 * chain today, so it is always omitted on both fixtures — that is the
 * expected behaviour, not a gap in either fixture.
 */
describe('RA-434: Additional information tab', () => {
  describe('reprocessor fixture (no wasteProcessingType)', () => {
    before(async () => {
      await login.login()
      // RA-299: a bare landing defaults to assigned-to-me, which would hide
      // this unassigned seeded item — reset to an explicit empty filter.
      await workItems.resetFilters()
      await workItems.searchByOrgName(REPROCESSOR.ORG_NAME)
      await browser.waitUntil(
        async () => (await browser.getUrl()).includes('filtersApplied=1'),
        { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
      )
      // Hard gate: the search must resolve to exactly the one seeded item,
      // so "the first row" is unambiguous.
      expect(await workItems.getRowCount()).toBe(1)
      await workItems.openFirstListedWorkItem()
      await detail.gotoAdditionalInformation()
    })

    it('is reached as the active tab', async () => {
      expect(await detail.isActiveTab('additionalInformation')).toBe(true)
    })

    it('renders the rows in the fixed order, Site name omitted', async () => {
      expect(await detail.additionalInformationRowOrder()).toEqual([
        'organisation-name',
        'companies-house-number',
        'company-registered-address',
        'site-address',
        'permit-numbers'
      ])
    })

    it('shows the registered name', async () => {
      expect(
        await detail.additionalInformationRowText('organisation-name')
      ).toContain(REPROCESSOR.ORG_NAME)
    })

    it('shows the companies house number', async () => {
      expect(
        await detail.additionalInformationRowText('companies-house-number')
      ).toContain(REPROCESSOR.COMPANIES_HOUSE_NUMBER)
    })

    it('shows the full registered address', async () => {
      expect(
        await detail.additionalInformationRowText('company-registered-address')
      ).toContain(REPROCESSOR.COMPANY_REGISTERED_ADDRESS)
    })

    it('shows the reprocessor site address, distinct from the registered address', async () => {
      const siteAddress =
        await detail.additionalInformationRowText('site-address')
      expect(siteAddress).toContain(REPROCESSOR.SITE_ADDRESS_LINE)
      expect(siteAddress).toContain(REPROCESSOR.SITE_ADDRESS_POSTCODE)

      // Compared as VALUES ONLY (not full row text): the two rows' labels
      // ("Site address" vs "Registered address") differ regardless, which
      // would make a row-text comparison here vacuously true.
      const siteAddressValue = await detail
        .additionalInformationValue('site-address')
        .getText()
      const registeredAddressValue = await detail
        .additionalInformationValue('company-registered-address')
        .getText()
      expect(siteAddressValue).not.toBe(registeredAddressValue)
    })

    it('shows the comma-joined permit numbers on one line', async () => {
      expect(
        await detail.additionalInformationRowText('permit-numbers')
      ).toContain(REPROCESSOR.PERMIT_NUMBERS_JOINED)
    })

    it('omits the Site name row — there is no producer field for it', async () => {
      expect(await detail.hasAdditionalInformationRow('site-name')).toBe(false)
    })

    after(async () => {
      await login.logout()
    })
  })

  describe('exporter fixture (wasteProcessingType: exporter, no siteAddress)', () => {
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
      await detail.gotoAdditionalInformation()
    })

    it('shows the registered name, companies house number and permit numbers', async () => {
      expect(
        await detail.additionalInformationRowText('organisation-name')
      ).toContain(EXPORTER.ORG_NAME)
      expect(
        await detail.additionalInformationRowText('companies-house-number')
      ).toContain(EXPORTER.COMPANIES_HOUSE_NUMBER)
      expect(
        await detail.additionalInformationRowText('permit-numbers')
      ).toContain(EXPORTER.PERMIT_NUMBERS_JOINED)
    })

    // The point of this fixture: re-ex has no site for an exporter, so the
    // Site address row falls back to the registered address rather than
    // being omitted — intentionally making the two rows equal, matching the
    // OJ frontend's own header for an exporter.
    it('falls back the Site address row to the registered address', async () => {
      expect(await detail.hasAdditionalInformationRow('site-address')).toBe(
        true
      )
      // Compared as VALUES ONLY (not full row text): the rows' labels
      // ("Site address" vs "Registered address") always differ, so
      // comparing row text here would fail even though the underlying
      // values are genuinely equal.
      const siteAddress = await detail
        .additionalInformationValue('site-address')
        .getText()
      const registeredAddress = await detail
        .additionalInformationValue('company-registered-address')
        .getText()
      expect(siteAddress).toBe(registeredAddress)
      expect(siteAddress).toBe(EXPORTER.COMPANY_REGISTERED_ADDRESS)
    })

    it('still omits the Site name row', async () => {
      expect(await detail.hasAdditionalInformationRow('site-name')).toBe(false)
    })

    after(async () => {
      await login.logout()
    })
  })
})
