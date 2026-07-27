import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'

/**
 * Applications list — payload values + filter sections (RA-324).
 *
 * The results region is a set of "Applications" cards, so the old table
 * column-header assertions no longer apply — organisation name and material
 * render as fields inside the card (covered here; the full card layout and
 * field order live in ra-324-applications-page.e2e.js). RA-324 phase-2 rebuilt
 * the filter sidebar into collapsible <details> sections, exercised here at the
 * structural level (the detailed filter behaviour is in
 * ra-324-applications-filters.e2e.js).
 *
 * Exercised here:
 *   • "Org name" and "Material" render from the work item payload in the card.
 *   • The eight collapsible filter sections are present, with the four UK
 *     nations and the Reprocessor / Exporter Type options, and applying a
 *     Nation filter reaches the URL.
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
      // RA-324 phase-2: the card renders the material DISPLAY LABEL
      // (aluminium -> "Aluminium"), matching the filter checkboxes/chips, not
      // the raw lowercase payload token.
      await expect(workItems.tileField(createdId, 'material')).toHaveText(
        expect.stringContaining('Aluminium')
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
