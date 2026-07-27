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

  // ── Collapsible filter sections (RA-324 phase-2) ─────────────────────────── //

  describe('collapsible filter sections', () => {
    before(async () => {
      await workItems.goto()
    })

    it('renders each phase-2 filter section as a collapsible toggle', async () => {
      for (const key of [
        'sort',
        'type',
        'nation',
        'material',
        'assignment',
        'status',
        'organisation',
        'archived'
      ]) {
        await expect(workItems.filterSectionToggle(key)).toExist()
      }
    })

    it('offers the four UK nations as Nation options', async () => {
      for (const nation of [
        'England',
        'Scotland',
        'Wales',
        'NorthernIreland'
      ]) {
        await expect($(`input[name="nation"][value="${nation}"]`)).toExist()
      }
    })

    it('offers Reprocessor and Exporter Type options', async () => {
      await expect(
        $('input[name="typeId"][value="re-accreditation"]')
      ).toExist()
      await expect($('input[name="typeId"][value="exporter"]')).toExist()
    })

    it('applying a Nation filter appends the nation value to the URL', async () => {
      await workItems.goto()
      await workItems.checkRegulator('England')
      await workItems.applyFilters()
      expect(await browser.getUrl()).toContain('nation=England')
    })
  })
})
