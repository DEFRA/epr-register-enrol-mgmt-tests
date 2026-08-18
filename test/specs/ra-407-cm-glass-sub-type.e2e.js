import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-407 — CM displays the glass sub type correctly.
 *
 * The case-management Application details panel must show a "Glass sub type"
 * row, directly after Material, for GLASS applications. management-fe (companion
 * PR on the matching branch) renders it from `payload.glassRecyclingProcess`:
 *   - `glass_re_melt` -> "Glass - Remelt"
 *   - `glass_other`   -> "Glass - other"
 * and OMITS the row when the material is not glass, or when
 * `glassRecyclingProcess` is absent.
 *
 * The testid `app-detail-value-glass-sub-type` and the value strings
 * "Glass - Remelt" / "Glass - other" are LEAD-FIXED — asserted here against the
 * contract, not against whatever the FE happens to render. If a local run shows
 * a different value, the mismatch is escalated to the lead rather than tweaked
 * to match.
 *
 * `glassRecyclingProcess` cannot be set through the "Create work item" form, so
 * this runs against three raw-seeded glass work items inserted by the compose
 * Mongo init script docker/scripts/mongodb/30-glass-sub-type-work-items.js:
 *   - "RA-407 Glass Remelt Ltd"    (glass_re_melt)
 *   - "RA-407 Glass Other Ltd"     (glass_other)
 *   - "RA-407 Glass No Subtype Ltd" (no glassRecyclingProcess — the negative)
 */

/**
 * Search for exactly one seeded glass item by org name and open its detail
 * page. resetFilters first because a bare landing defaults to
 * assigned-to-me, which would hide these unassigned seeded items; the
 * row-count gate keeps "the first row" unambiguous.
 */
async function openSeededGlassItem(organisationName) {
  await workItems.resetFilters()
  await workItems.searchByOrgName(organisationName)
  await browser.waitUntil(
    async () => (await browser.getUrl()).includes('filtersApplied=1'),
    { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
  )
  expect(await workItems.getRowCount()).toBe(1)
  await workItems.openFirstListedWorkItem()
}

describe('RA-407 — glass sub type on the CM Application details panel', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('glass_re_melt', () => {
    before(async () => {
      await openSeededGlassItem('RA-407 Glass Remelt Ltd')
    })

    it('shows the material row as Glass', async () => {
      await expect(detail.applicationDetailValue('material')).toHaveText(
        expect.stringContaining('Glass')
      )
    })

    it('shows a "Glass sub type" row with value "Glass - Remelt"', async () => {
      await expect(await detail.hasGlassSubTypeRow()).toBe(true)
      await expect(detail.glassSubTypeValue()).toHaveText('Glass - Remelt')
    })
  })

  describe('glass_other', () => {
    before(async () => {
      await openSeededGlassItem('RA-407 Glass Other Ltd')
    })

    it('shows a "Glass sub type" row with value "Glass - other"', async () => {
      await expect(await detail.hasGlassSubTypeRow()).toBe(true)
      await expect(detail.glassSubTypeValue()).toHaveText('Glass - other')
    })
  })

  describe('glass application with no glassRecyclingProcess', () => {
    before(async () => {
      await openSeededGlassItem('RA-407 Glass No Subtype Ltd')
    })

    it('shows the material row as Glass', async () => {
      // Prove the item did load its application details, so the absent row
      // below is a genuine omission and not a page that failed to render.
      await expect(detail.applicationDetailValue('material')).toHaveText(
        expect.stringContaining('Glass')
      )
    })

    it('does NOT render the "Glass sub type" row', async () => {
      await expect(await detail.hasGlassSubTypeRow()).toBe(false)
      await expect(detail.glassSubTypeValue()).not.toBeExisting()
    })
  })
})
