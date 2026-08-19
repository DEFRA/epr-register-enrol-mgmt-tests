import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import query, {
  QUERY_SECTIONS,
  EXPORTER_ONLY_QUERY_SECTIONS,
  REPROCESSOR_QUERY_SECTIONS
} from '../page-objects/query.page.js'

/**
 * RA-367 — hide the exporter-only query areas for reprocessor applications.
 *
 * The "Query an application" form asks "Which areas do you want to query?" and
 * offers six areas. Two of them — Broadly equivalent standards (BES) and
 * Overseas reprocessing sites (ORS) — are EXPORTER-ONLY. For a reprocessor
 * application they must NOT appear; for an exporter application they must.
 *
 * WHAT DRIVES IT. There is no `wasteProcessingType` discriminator in the work
 * item payload — management-be never writes one (see RA-295's spec header). The
 * frontend therefore gates the two areas on `isExporterApplication(workItem)`,
 * the same PROXY RA-295 uses for the exporter-only detail rows: it is true iff
 * `payload.overseasSites.sites` is non-empty. So under test:
 *   - exporter (shows all six)   = a work item WITH overseas sites;
 *   - reprocessor (hides BES/ORS)= a work item with NO overseas sites.
 * (Confirmed by management-fe; the fe change reuses application-summary.js's
 * isExporterApplication.)
 *
 *   AC01 — a reprocessor query form does NOT show BES or ORS; the other four
 *          areas are present.
 *   AC02 — an exporter query form DOES show all six areas, including BES/ORS.
 *
 * Fixtures:
 *   - AC01 uses a work item created through the case management "Create work
 *     item" form. Such items carry no overseasSites, so they are reprocessors —
 *     exactly the discriminator AC01 needs, and the same creation path RA-291's
 *     query specs use, so no seeded fixture is required.
 *   - AC02 uses the seeded "Full Payload Verification Ltd" re-accreditation item
 *     (ReAccreditationSeeder), the one fixture whose payload carries
 *     overseasSites — i.e. the only exporter under the proxy. This spec only
 *     GETs its query form (never submits), so the shared fixture is left
 *     unqueried for the other specs that rely on it.
 */

const uniqueOrg = (label) => `${label} ${Date.now()}`

/**
 * Create a Submitted (reprocessor) application to query.
 *
 * Mirrors RA-291's helper, including the per-caller postcode: work items
 * created through the UI carry no operator organisation id, so the reference
 * generator derives it from the site postcode and material alone — items
 * sharing both exhaust its collision-retry budget and the submission fails.
 */
const createReprocessorWorkItem = async (organisationName, postcode) => {
  await workItems.goto()
  return (
    await workItems.createWorkItem({
      organisationName,
      siteAddressLine1: '1 Query Areas Street',
      siteAddressTown: 'London',
      siteAddressPostcode: postcode,
      material: 'plastic',
      tonnageBand: '0-500'
    })
  ).id
}

describe('RA-367 Exporter-only query areas', () => {
  describe('AC01 — a reprocessor application hides BES and ORS', () => {
    let workItemId

    before(async () => {
      await login.login()
      workItemId = await createReprocessorWorkItem(
        uniqueOrg('Query Reprocessor Ltd'),
        'SW1A 3RA'
      )
    })

    after(async () => {
      await login.logout()
    })

    it('does not render the Broadly equivalent standards or Overseas reprocessing sites checkboxes', async () => {
      await query.gotoFor(workItemId)
      const rendered = []
      for (const section of EXPORTER_ONLY_QUERY_SECTIONS) {
        if (await query.hasSection(section)) {
          rendered.push(section)
        }
      }
      expect(rendered).toEqual([])
    })

    it('still renders the four areas common to every application', async () => {
      // Report as one aggregate so a failure names every missing area at once,
      // rather than stopping at the first and hiding the rest. Guards against
      // the hiding being implemented by dropping the whole checkbox group.
      await query.gotoFor(workItemId)
      const missing = []
      for (const section of REPROCESSOR_QUERY_SECTIONS) {
        if (!(await query.hasSection(section))) {
          missing.push(section)
        }
      }
      expect(missing).toEqual([])
    })

    it('offers exactly the four reprocessor areas and no more', async () => {
      // The count pins the negative: were BES/ORS still emitted (e.g. hidden by
      // CSS rather than not rendered), the input count would stay at six and
      // this fails even though the presence checks above might not.
      await query.gotoFor(workItemId)
      expect(await query.countSectionOptions()).toBe(
        REPROCESSOR_QUERY_SECTIONS.length
      )
    })
  })

  // This is the positive half AC01's hiding needs to be meaningful: without an
  // exporter case proving all six CAN render, "reprocessor hides two" could
  // pass against a build that simply never emits BES/ORS to anyone.
  describe('AC02 — an exporter application shows all six areas', () => {
    let workItemId

    before(async () => {
      await login.login()
      // RA-299: a bare landing defaults to assigned-to-me, which would hide this
      // (unassigned) seeded item — reset to an explicit empty filter first so
      // the search is not implicitly assignee-scoped.
      await workItems.resetFilters()
      await workItems.searchByOrgName('Full Payload Verification Ltd')
      await browser.waitUntil(
        async () => (await browser.getUrl()).includes('filtersApplied=1'),
        { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
      )
      // Hard gate: the search must resolve to exactly the one seeded item, so
      // its id is unambiguous.
      expect(await workItems.getRowCount()).toBe(1)
      workItemId = await workItems.firstResultWorkItemId()
    })

    after(async () => {
      await login.logout()
    })

    it('renders the Broadly equivalent standards and Overseas reprocessing sites checkboxes', async () => {
      await query.gotoFor(workItemId)
      const missing = []
      for (const section of EXPORTER_ONLY_QUERY_SECTIONS) {
        if (!(await query.hasSection(section))) {
          missing.push(section)
        }
      }
      expect(missing).toEqual([])
    })

    it('offers all six queryable areas', async () => {
      await query.gotoFor(workItemId)
      const missing = []
      for (const section of QUERY_SECTIONS) {
        if (!(await query.hasSection(section))) {
          missing.push(section)
        }
      }
      expect(missing).toEqual([])
      expect(await query.countSectionOptions()).toBe(QUERY_SECTIONS.length)
    })
  })
})
