import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import query, {
  QUERY_SECTIONS,
  EXPORTER_ONLY_QUERY_SECTIONS,
  REPROCESSOR_QUERY_SECTIONS
} from '../page-objects/query.page.js'
import { createExporterWorkItem } from '../support/ra-434-fixture.js'

/**
 * RA-367 — hide the exporter-only query areas for reprocessor applications.
 *
 * The "Query an application" form asks "Which areas do you want to query?" and
 * offers six areas. Two of them — Broadly equivalent standards (BES) and
 * Overseas reprocessing sites (ORS) — are EXPORTER-ONLY. For a reprocessor
 * application they must NOT appear; for an exporter application they must.
 *
 * WHAT DRIVES IT. The frontend gates the two areas on
 * `isExporterApplication(workItem)`, which RA-314 rewrote to read the work item
 * payload's `wasteProcessingType`: exporter iff that field is the string
 * 'exporter' (case-insensitive); absent or any other value → reprocessor.
 * (Confirmed final by management-fe against main. Overseas-sites presence was an
 * earlier proxy and is NOT the signal any more.)
 *
 *   AC01 — a reprocessor query form does NOT show BES or ORS; the other four
 *          areas are present.
 *   AC02 — an exporter query form DOES show all six areas, including BES/ORS.
 *
 * Fixtures & the AC02 gap:
 *   - AC01 uses a work item created through the case management "Create work
 *     item" form. Such items carry no `wasteProcessingType`, so they are
 *     reprocessors — exactly the discriminator AC01 needs, and the same
 *     creation path RA-291's query specs use.
 *   - AC02 needs a work item whose payload sets `wasteProcessingType='exporter'`.
 *     The Create form has no applicant-type field, so the exporter is
 *     submitted through the API instead (RA-434's exporter fixture,
 *     support/ra-434-fixture.js).
 */

/** Create a Submitted (reprocessor) application to query. Mirrors RA-291's helper. */
const createReprocessorWorkItem = async (organisationNamePrefix) => {
  await workItems.goto()
  return workItems.createWorkItem({
    organisationNamePrefix,
    siteAddressLine1: '1 Query Areas Street',
    siteAddressTown: 'London',
    material: 'plastic',
    tonnageBand: '0-500'
  })
}

describe('RA-367 Exporter-only query areas', () => {
  describe('AC01 — a reprocessor application hides BES and ORS', () => {
    let workItemId

    before(async () => {
      await login.login()
      ;({ id: workItemId } = await createReprocessorWorkItem(
        'Query Reprocessor Ltd'
      ))
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

  // AC02 — an exporter application shows all six areas. The positive half
  // AC01's hiding needs to be meaningful: without it, "reprocessor hides two"
  // could pass against a build that never emits BES/ORS to anyone. The
  // exporter is RA-434's fixture, submitted through the API, and this block
  // only GETs its query form.
  describe('AC02 — an exporter application shows all six areas', () => {
    let workItemId

    before(async () => {
      await login.login()
      ;({ id: workItemId } = await createExporterWorkItem())
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
