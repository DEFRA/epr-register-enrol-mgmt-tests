import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import applicationDetails from '../page-objects/application-details.page.js'

/**
 * RA-254: Application details page — full operator payload.
 *
 * The other re-accreditation e2e specs use work items created via the case
 * management "Create work item" form, which only populates a small subset
 * of fields (organisation name, site address, material, tonnage band). That
 * subset never exercises submittedBy, prns.authorisers, businessPlan,
 * samplingPlan.files or overseasSites.besEvidence — so a regression that
 * drops one of those fields between the operator payload and the
 * Application details page would go unnoticed by e2e coverage.
 *
 * This spec targets the "full-payload-verification" seed item
 * (ReAccreditationSeeder), the only work item carrying every field a real
 * operator submission can send, and asserts each one renders.
 *
 * RA-319 fast-follow: the "BES-evidence section" describe block below adds
 * the e2e coverage flagged as missing in mgmt-tests#62 — management-fe#117
 * added the BES-evidence UI with only unit tests, so this asserts the
 * overseas-site download link renders and resolves the same way the
 * sampling-plan one does.
 */
describe('Application details page — full operator payload (seeded)', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.goto()
    await workItems.searchByOrgName('Full Payload Verification Ltd')
    workItemId = await workItems.firstResultWorkItemId()
    await applicationDetails.open(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  describe('overview section', () => {
    it('shows organisation name', async () => {
      expect(
        await applicationDetails.getSummaryValueByKey('Organisation name')
      ).toBe('Full Payload Verification Ltd')
    })

    it('shows registration number', async () => {
      expect(
        await applicationDetails.getSummaryValueByKey('Registration number')
      ).toBe('EPR-100999')
    })

    it('shows material', async () => {
      expect(await applicationDetails.getSummaryValueByKey('Material')).toBe(
        'plastic'
      )
    })

    it('shows accreditation year', async () => {
      expect(
        await applicationDetails.getSummaryValueByKey('Accreditation year')
      ).toBe('2026')
    })

    it('shows previous accreditation year', async () => {
      expect(
        await applicationDetails.getSummaryValueByKey(
          'Previous accreditation year'
        )
      ).toBe('2025')
    })

    it('shows compliance issues reported', async () => {
      expect(
        await applicationDetails.getSummaryValueByKey(
          'Compliance issues reported'
        )
      ).toBe('0')
    })

    it('shows site address', async () => {
      expect(
        await applicationDetails.getSummaryValueByKey('Site address')
      ).toBe('1 Full Payload Lane, London')
    })

    it('shows site postcode', async () => {
      expect(
        await applicationDetails.getSummaryValueByKey('Site postcode')
      ).toBe('EC1A 1BB')
    })
  })

  describe('operator reference section', () => {
    it('shows operator application ID', async () => {
      expect(
        await applicationDetails.getSummaryValueByKey('Operator application ID')
      ).toBe('app-full-payload-001')
    })

    it('shows operator organisation ID', async () => {
      expect(
        await applicationDetails.getSummaryValueByKey(
          'Operator organisation ID'
        )
      ).toBe('org-full-payload-001')
    })

    it('shows operator registration ID', async () => {
      expect(
        await applicationDetails.getSummaryValueByKey(
          'Operator registration ID'
        )
      ).toBe('reg-full-payload-001')
    })

    it('shows operator email', async () => {
      expect(
        await applicationDetails.getSummaryValueByKey('Operator email')
      ).toBe('full.payload@example.com')
    })
  })

  describe('declaration section', () => {
    it('is shown', async () => {
      expect(await applicationDetails.isDeclarationShown()).toBe(true)
    })

    it('shows full name', async () => {
      expect(await applicationDetails.getSummaryValueByKey('Full name')).toBe(
        'Priya Sharma'
      )
    })

    it('shows job title', async () => {
      expect(await applicationDetails.getSummaryValueByKey('Job title')).toBe(
        'Compliance Manager'
      )
    })

    it('shows email', async () => {
      expect(await applicationDetails.getSummaryValueByKey('Email')).toBe(
        'priya.sharma@example.com'
      )
    })
  })

  describe('PRNs section', () => {
    it('shows the planned tonnage band', async () => {
      expect(
        await applicationDetails.getSummaryValueByKey('Planned tonnage band')
      ).toBe('Up to 1,000 tonnes')
    })

    it('shows the authoriser name and email', async () => {
      expect(await applicationDetails.isAuthorisersEmpty()).toBe(false)
      const text = await applicationDetails.getAuthorisersTableText()
      expect(text).toContain('Tom Baker')
      expect(text).toContain('tom.baker@example.com')
    })
  })

  describe('business plan section', () => {
    it('is not shown as empty', async () => {
      expect(await applicationDetails.isBusinessPlanEmpty()).toBe(false)
    })

    const businessPlanCases = [
      ['New infrastructure (%)', '20%'],
      ['New infrastructure (detail)', 'New sorting line investment'],
      ['Price support (%)', '15%'],
      ['Price support (detail)', 'Subsidised collection scheme'],
      ['Business collections (%)', '25%'],
      ['Business collections (detail)', 'Kerbside collection expansion'],
      ['Communications (%)', '10%'],
      ['Communications (detail)', 'Customer awareness campaign'],
      ['New markets (%)', '20%'],
      ['New markets (detail)', 'New export contracts secured'],
      ['New uses (%)', '10%'],
      ['New uses (detail)', 'Recycled content packaging trial']
    ]

    businessPlanCases.forEach(([key, value]) => {
      it(`shows ${key} as ${value}`, async () => {
        expect(await applicationDetails.getSummaryValueByKey(key)).toBe(value)
      })
    })
  })

  describe('sampling plan section', () => {
    it('is not shown as empty', async () => {
      expect(await applicationDetails.isSamplingPlanEmpty()).toBe(false)
    })

    it('shows the uploaded filename and clean scan status', async () => {
      const text = await applicationDetails.getSamplingFilesTableText()
      expect(text).toContain('sampling-plan.pdf')
      expect(text).toContain('Clean')
    })

    it('shows a download link for the clean file', async () => {
      expect(await applicationDetails.isSamplingFileDownloadShown()).toBe(true)
    })

    it('download link points at the file download route for this work item', async () => {
      const href = await applicationDetails.getSamplingFileDownloadHref()
      expect(href).toContain(`/work-items/${workItemId}/files/`)
      expect(href).toContain('/download')
    })
  })

  describe('BES-evidence section (overseas sites)', () => {
    it('shows the overseas site name', async () => {
      expect(await applicationDetails.getOverseasSiteName()).toContain(
        'Full Payload Verification Overseas Site'
      )
    })

    it('shows the uploaded filename and clean scan status', async () => {
      const text = await applicationDetails.getBesEvidenceFilesTableText()
      expect(text).toContain('bes-evidence.pdf')
      expect(text).toContain('Clean')
    })

    it('shows a download link for the clean file', async () => {
      expect(await applicationDetails.isBesEvidenceFileDownloadShown()).toBe(
        true
      )
    })

    it('download link points at the file download route for this work item', async () => {
      const href = await applicationDetails.getBesEvidenceFileDownloadHref()
      expect(href).toContain(`/work-items/${workItemId}/files/`)
      expect(href).toContain('/download')
    })
  })

  describe('link from detail page', () => {
    before(async () => {
      await workItems.openWorkItem(workItemId)
    })

    it('shows the "View full application details" link', async () => {
      await expect(
        $('[data-testid="view-application-details-link"]')
      ).toBeDisplayed()
    })
  })
})
