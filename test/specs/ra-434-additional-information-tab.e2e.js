import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail, {
  CONTACT_DETAIL_ROWS
} from '../page-objects/work-item-detail.page.js'
import {
  EXPORTER,
  REPROCESSOR,
  createExporterWorkItem,
  createReprocessorWorkItem
} from '../support/ra-434-fixture.js'

/**
 * RA-434 / RA-480 — the "Additional information" tab.
 *
 * A third tab on the work item detail page, alongside "Application summary"
 * and "Application history" (RA-295), showing rows sourced from the
 * operator's re-ex submission: Registered name, Companies house number,
 * Registered address, Site name, Site address, Permit numbers, Contact full
 * name, Contact email, Contact phone, Contact job title — in that fixed
 * order. Missing rows are OMITTED entirely (no em-dash placeholder) rather
 * than rendered with a blank value.
 *
 * Two fixtures cover the tab's real conditionals: re-ex has no site for an
 * exporter, so an exporter's Site address row falls back to the registered
 * address (matching the Registration & Accreditation service's own header); a reprocessor (or a work item with no
 * `wasteProcessingType` at all) keeps a genuine site address. Site name has
 * no producer field anywhere in the chain today, so it is always omitted on
 * both fixtures. The EXPORTER fixture also carries a populated
 * `submitterContactDetails` block, while REPROCESSOR has none — giving the
 * four contact rows a populated + blank case.
 */
describe('RA-434: Additional information tab', () => {
  describe('reprocessor fixture (no wasteProcessingType)', () => {
    let item

    before(async () => {
      await login.login()
      item = await createReprocessorWorkItem()
      await workItems.openWorkItem(item.id)
      await workItems.waitForDetailPage()
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
      ).toContain(item.organisationName)
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
      expect(siteAddress).toContain(item.payload.siteAddressPostcode)

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

    it('omits the four contact rows — this fixture has no submitterContactDetails', async () => {
      for (const key of CONTACT_DETAIL_ROWS) {
        expect(await detail.hasAdditionalInformationRow(key)).toBe(false)
      }
    })

    after(async () => {
      await login.logout()
    })
  })

  describe('exporter fixture (wasteProcessingType: exporter, no siteAddress)', () => {
    let item

    before(async () => {
      await login.login()
      item = await createExporterWorkItem()
      await workItems.openWorkItem(item.id)
      await workItems.waitForDetailPage()
      await detail.gotoAdditionalInformation()
    })

    it('shows the registered name, companies house number and permit numbers', async () => {
      expect(
        await detail.additionalInformationRowText('organisation-name')
      ).toContain(item.organisationName)
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
    // Registration & Accreditation service frontend's own header for an exporter.
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

    it('shows the four contact rows from submitterContactDetails', async () => {
      expect(
        await detail.additionalInformationRowText('contact-full-name')
      ).toContain(EXPORTER.CONTACT_FULL_NAME)
      expect(
        await detail.additionalInformationRowText('contact-email')
      ).toContain(EXPORTER.CONTACT_EMAIL)
      expect(
        await detail.additionalInformationRowText('contact-phone')
      ).toContain(EXPORTER.CONTACT_PHONE)
      expect(
        await detail.additionalInformationRowText('contact-job-title')
      ).toContain(EXPORTER.CONTACT_JOB_TITLE)
    })

    after(async () => {
      await login.logout()
    })
  })
})
