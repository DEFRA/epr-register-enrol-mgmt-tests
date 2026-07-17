import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'

/**
 * Work items list page improvements.
 *
 * Acceptance criteria exercised here:
 *   • "SLA" column header renamed to "Due date (SLA)".
 *   • "Org name" and "Material" columns added, sourced from the work item payload.
 *   • Nation filter section renamed to "Regulator" with regulator body display names.
 *   • Applicant type filter section added with disabled Reprocessor / Exporter
 *     checkboxes (placeholder — filtering not yet wired to backend data).
 */
describe('Work items list improvements', () => {
  let createdId

  before(async () => {
    await login.loginAs('assign')
    await workItems.goto()
    ;({ id: createdId } = await workItems.createWorkItem({
      organisationName: 'Delta Recyclers Ltd',
      siteAddressLine1: '12 Improvement Road',
      siteAddressTown: 'Leeds',
      siteAddressPostcode: 'LS1 2AL',
      material: 'aluminium',
      tonnageBand: '0-500'
    }))
    await workItems.goto()
  })

  after(async () => {
    await login.logout()
  })

  // ── Table column headers ─────────────────────────────────────────────────── //

  describe('table column headers', () => {
    it('shows "Due date (SLA)" as the SLA column header', async () => {
      const headers = await workItems.getTableHeaderTexts()
      expect(headers).toContain('Due date (SLA)')
    })

    it('does not show a bare "SLA" column header', async () => {
      const headers = await workItems.getTableHeaderTexts()
      expect(headers).not.toContain('SLA')
    })

    it('shows "Org name" and "Material" column headers', async () => {
      const headers = await workItems.getTableHeaderTexts()
      expect(headers).toContain('Org name')
      expect(headers).toContain('Material')
    })
  })

  // ── Org name and Material values ─────────────────────────────────────────── //

  describe('Org name and Material columns show payload values', () => {
    it('shows the organisation name from the work item payload in the list row', async () => {
      const row = workItems.workItemRow(createdId)
      await expect(row).toHaveText(
        expect.stringContaining('Delta Recyclers Ltd')
      )
    })

    it('shows the material from the work item payload in the list row', async () => {
      const row = workItems.workItemRow(createdId)
      await expect(row).toHaveText(expect.stringContaining('aluminium'))
    })
  })

  // ── Regulator filter ─────────────────────────────────────────────────────── //

  describe('Regulator filter panel', () => {
    before(async () => {
      await workItems.goto()
    })

    it('shows "Regulator" as the filter section heading', async () => {
      const legends = await workItems.getFilterLegendTexts()
      expect(legends).toContain('Regulator')
    })

    it('does not show a "Nation" heading in the filter panel', async () => {
      const legends = await workItems.getFilterLegendTexts()
      expect(legends).not.toContain('Nation')
    })

    it('shows regulator body names as filter options', async () => {
      const options = await workItems.getRegulatorOptionTexts()
      expect(options).toContain('Environment Agency (EA)')
      expect(options).toContain('SEPA')
      expect(options).toContain('Natural Resources Wales (NRW)')
      expect(options).toContain('NIEA')
    })

    it('applying a regulator filter appends the nation value to the URL', async () => {
      await $('input[name="nation"][value="England"]').click()
      await $('[data-testid="work-items-filter-apply"]').click()
      expect(await browser.getUrl()).toContain('nation=England')
    })
  })

  // ── Applicant type filter (placeholder) ──────────────────────────────────── //

  describe('Applicant type filter (placeholder)', () => {
    before(async () => {
      await workItems.goto()
    })

    it('shows an "Applicant type" section in the filter panel', async () => {
      const legends = await workItems.getFilterLegendTexts()
      expect(legends).toContain('Applicant type')
    })

    it('shows Reprocessor and Exporter checkboxes', async () => {
      const reprocessor = $('input[name="applicantType"][value="reprocessor"]')
      const exporter = $('input[name="applicantType"][value="exporter"]')
      await expect(reprocessor).toExist()
      await expect(exporter).toExist()
    })

    it('Reprocessor and Exporter checkboxes are disabled (not yet wired to data)', async () => {
      const reprocessor = $('input[name="applicantType"][value="reprocessor"]')
      const exporter = $('input[name="applicantType"][value="exporter"]')
      expect(await reprocessor.getProperty('disabled')).toBe(true)
      expect(await exporter.getProperty('disabled')).toBe(true)
    })
  })
})
