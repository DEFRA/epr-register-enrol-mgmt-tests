import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'

/**
 * Work items list page improvements.
 *
 * RA-324 redesigned the results region from a govukTable into "Applications"
 * tiles, so the old column-header assertions no longer apply — the org name
 * and material now render as fields inside the item's tile (covered here) and
 * the tile layout/field-order is covered in full by
 * ra-324-applications-page.e2e.js. The filter panel is unchanged by the
 * redesign, so the Regulator and Applicant type filter assertions carry over
 * verbatim.
 *
 * Acceptance criteria exercised here:
 *   • "Org name" and "Material" render from the work item payload in the tile.
 *   • Nation filter section renamed to "Regulator" with regulator body display names.
 *   • Applicant type filter section with disabled Reprocessor / Exporter
 *     checkboxes (placeholder — filtering not yet wired to backend data).
 */
describe('Work items list improvements', () => {
  let createdId

  before(async () => {
    await login.login()
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

  // ── Org name and Material values in the tile ─────────────────────────────── //

  describe('Org name and Material render from the payload in the tile', () => {
    before(async () => {
      // Bound the list to this spec's item so the tile is on the page
      // regardless of how many items other specs have created.
      await workItems.goto()
      await workItems.searchByOrgName('Delta Recyclers Ltd')
    })

    it('shows the organisation name from the work item payload in the tile', async () => {
      await expect(workItems.tileField(createdId, 'org-name')).toHaveText(
        expect.stringContaining('Delta Recyclers Ltd')
      )
    })

    it('shows the material from the work item payload in the tile', async () => {
      await expect(workItems.tileField(createdId, 'material')).toHaveText(
        expect.stringContaining('aluminium')
      )
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
