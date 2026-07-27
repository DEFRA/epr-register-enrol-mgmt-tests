import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'

/**
 * RA-299 — Application-type filter + Glass material split.
 *
 * Two of the five real gaps found in the RA-299 scoping audit against the
 * RA-324 phase-2 filter overhaul (see epr-87um):
 *
 *  - AC01/15: a NEW "Application type" filter section (data-testid
 *    filter-section-application-type, param applicationType) alongside — not
 *    instead of — the existing "Applicant type" section (data-testid
 *    filter-section-type, param typeId, unchanged: checkType). Only
 *    Re-accreditation maps to a real typeId; Accreditation, Registration
 *    application and Payment of annual registration fee are stub typeIds
 *    with no matching data yet, mirroring the existing Exporter stub in the
 *    Applicant type section.
 *  - AC05: the single "Glass" material option split into "Glass- remelt" and
 *    "Glass- other" (materials.js). Both map to the SAME real backend token
 *    ('glass') — there is no data yet that distinguishes them, so this spec
 *    only asserts both render as independently selectable options and both
 *    filter to the same Glass items the old single option used to, NOT that
 *    they return different result sets.
 *
 * Selectors/params confirmed by fe (management-fe PR #129, commits
 * d49af57/e869058/d520c64) on branch ra-324-applications-page.
 */

const token = `AppType${Date.now()}`

const createItem = (organisationName, postcode, material) =>
  workItems.goto().then(() =>
    workItems.createWorkItem({
      organisationName,
      siteAddressLine1: '1 Application Type Way',
      siteAddressTown: 'London',
      siteAddressPostcode: postcode,
      material,
      tonnageBand: '0-500'
    })
  )

describe('RA-299 — Application type filter and Glass material split', () => {
  let glassItem
  let plasticItem

  before(async () => {
    await login.login()
    glassItem = await createItem(`${token} Glass`, 'SW1A 9AC', 'glass')
    plasticItem = await createItem(`${token} Plastic`, 'SW1A 9AD', 'plastic')
  })

  after(async () => {
    await login.logout()
  })

  // ── AC01/15: Application type — new section, distinct from Applicant type ── //

  describe('Application type filter section', () => {
    // RA-299 (AC10/14) session persistence means a bare goto() now restores
    // whatever an earlier test in this same login left applied — reset to an
    // explicit empty state before each test so selections don't accumulate
    // across `it`s (see resetFilters doc comment).
    beforeEach(async () => {
      await workItems.resetFilters()
    })

    it('is a distinct section from Applicant type, collapsed by default', async () => {
      await workItems.goto()
      // Both sections exist independently and neither's toggle affects the
      // other.
      expect(await workItems.isSectionOpen('application-type')).toBe(false)
      expect(await workItems.isSectionOpen('type')).toBe(false)

      await workItems.expandSection('application-type')
      expect(await workItems.isSectionOpen('application-type')).toBe(true)
      expect(await workItems.isSectionOpen('type')).toBe(false)
    })

    it('the existing Applicant type section keeps working unchanged', async () => {
      // Re-accreditation via the ORIGINAL "Applicant type" section (param
      // typeId) still returns real results — must not have regressed.
      await workItems.goto()
      await workItems.checkType('re-accreditation')
      await workItems.applyFilters()
      expect(await workItems.getTileCount()).toBeGreaterThan(0)
    })

    it('Re-accreditation returns real results', async () => {
      await workItems.goto()
      await workItems.checkApplicationType('re-accreditation')
      await workItems.applyFilters()
      expect(await browser.getUrl()).toContain(
        'applicationType=re-accreditation'
      )
      expect(await workItems.getTileCount()).toBeGreaterThan(0)
    })
    ;[
      'accreditation',
      'registration-application',
      'annual-fee-payment'
    ].forEach((value) => {
      it(`${value} matches nothing (stub typeId, no data yet)`, async () => {
        await workItems.goto()
        await workItems.checkApplicationType(value)
        await workItems.applyFilters()
        expect(await browser.getUrl()).toContain(`applicationType=${value}`)
        await expect($('[data-testid="work-items-summary"]')).toHaveText(
          expect.stringContaining('No work items match your filters')
        )
      })
    })
  })

  // ── AC05: Glass split into "Glass- remelt" / "Glass- other" ───────────────── //

  describe('Glass material split', () => {
    // See the "Application type filter section" describe above — same
    // session-persistence accumulation risk applies here.
    beforeEach(async () => {
      await workItems.resetFilters()
    })

    it('renders both options as separate, independently selectable checkboxes', async () => {
      await workItems.goto()
      await workItems.expandSection('material')
      await expect($('input[name="material"][value="glass-remelt"]')).toExist()
      await expect($('input[name="material"][value="glass-other"]')).toExist()
      // The old single "glass" value is gone, replaced by the two above.
      await expect($('input[name="material"][value="glass"]')).not.toExist()
    })

    it('"Glass- remelt" filters to the same Glass items as before', async () => {
      await workItems.goto()
      await workItems.searchByOrg(token)
      await workItems.checkMaterial('glass-remelt')
      await workItems.applyFilters()
      await expect(workItems.tileFor(glassItem.id)).toBeDisplayed()
      await expect(workItems.tileFor(plasticItem.id)).not.toExist()
    })

    it('"Glass- other" filters to the same Glass items (same real backend token)', async () => {
      await workItems.goto()
      await workItems.searchByOrg(token)
      await workItems.checkMaterial('glass-other')
      await workItems.applyFilters()
      await expect(workItems.tileFor(glassItem.id)).toBeDisplayed()
      await expect(workItems.tileFor(plasticItem.id)).not.toExist()
    })
  })
})
