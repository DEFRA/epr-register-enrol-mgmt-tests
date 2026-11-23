import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import recyclingOperations from '../page-objects/recycling-operations.page.js'
import { withdrawAsOperatorOrThrow } from '../support/operator-withdrawal.js'
import { dulyMake } from '../support/re-accreditation-journey.js'
import { uniquePostcode } from '../support/unique-postcode.js'
import {
  createWorkItemViaApi,
  removeOverseasSitesViaApi
} from '../support/work-item-api.js'

/**
 * RA-768 — remove overseas sites the operator deselected before RA-557.
 *
 * Until RA-557, an operator who deselected an overseas reprocessing site while
 * answering a query had the shorter list saved only in
 * `payload.latestSections`; `payload.overseasSites.sites`, which every
 * case-management page reads, kept the original sites. Those work items were
 * never corrected. management-be adds
 * `POST /work-items/re-accreditation/{id}/overseas-sites/remove`, which removes
 * the named sites (by `orsId`, or by `siteId` when the entry has no `orsId`)
 * and records an `overseas-sites-corrected` audit entry, and the operator
 * journey backend gets a one-off migration that calls it.
 *
 * The migration only runs against real applications whose Registration &
 * Accreditation service record has the site deselected, which nothing this
 * suite creates can match, so the suite
 * plays the migration's call itself (`removeOverseasSitesViaApi`, as the
 * operator's service, the way `resume-from-query` is played). What it pins is
 * what a regulator then sees in case management.
 *
 * ACs under test:
 *   1. Corrected: the removed sites are gone from the Application summary's
 *      ORS and BES rows and from the Recycling operations tab.
 *   2. Only removals: the remaining site keeps its ORS ID, name, address and
 *      recycling operation codes.
 *   3. Untouched: a duly-made work item and a decided (withdrawn) one are
 *      refused with 409 and still list every site.
 *   4. Audit: one "Overseas sites corrected" history entry naming the removed
 *      site ids and the reason, and none for a call that removed nothing.
 *
 * Each work item is an EXPORTER created through `POST /work-items`: the ORS
 * and BES rows only exist for an exporter, and the "Create work item" form
 * cannot submit overseas sites (see ra-557-overseas-sites-resubmit.e2e.js).
 * Site C has no `orsId`, as a legacy site can, so the request names it by
 * `siteId` alone.
 *
 * AC 2's "operation codes a regulator changed in case management" is pinned
 * with codes set on submission, not changed through the Recycling operations
 * edit form:
 * that form saves through the operator journey backend, which only knows
 * applications it created, and `createOperatorBackedWorkItem` only creates
 * reprocessor applications, which have no overseas sites. A regulator's edit
 * lands in the same `payload.overseasSites.sites[].operationCodes` field the
 * submitted codes live in, which is what this spec shows the removal leaves
 * alone; management-be's endpoint tests cover an edited code directly.
 *
 * RA-768 AC 5's last bullet (a query resubmission that removes a site updates
 * the overseas sites today) is ra-557-overseas-sites-resubmit.e2e.js's
 * "reflects a removed overseas site after a second query and resubmission".
 */

const ACTION = 'overseas-sites-corrected'
const REASON =
  'RA-768: removed overseas sites the operator deselected in a query response before RA-557'

const siteA = {
  siteId: 1,
  orsId: 'ORS-2026-0768-A',
  siteName: 'Rotterdam RA-768 Site',
  siteAddress: '1 Havenstraat, Rotterdam',
  country: 'Netherlands',
  operationCodes: ['R3', 'R12']
}

const siteB = {
  siteId: 2,
  orsId: 'ORS-2026-0768-B',
  siteName: 'Hamburg RA-768 Site',
  siteAddress: '42 Hafenstrasse, Hamburg',
  country: 'Germany',
  operationCodes: ['R3']
}

// No `orsId`: matched by `siteId` alone.
const siteC = {
  siteId: 3,
  siteName: 'Antwerp RA-768 Site',
  siteAddress: '7 Kaaiplein, Antwerp',
  country: 'Belgium',
  operationCodes: ['R13']
}

/** The correction the migration would send for sites B and C. */
const REMOVE_B_AND_C = [
  { orsId: siteB.orsId, siteId: String(siteB.siteId) },
  { orsId: null, siteId: String(siteC.siteId) }
]

/**
 * A site's address lines. management-fe renders the flat `siteAddress` one
 * line per comma-separated part, so the joined string never appears as such.
 */
const addressLines = (site) => site.siteAddress.split(', ')

/** Text unique to the removed sites, which must appear nowhere. */
const REMOVED_SITE_TEXT = [siteB, siteC].flatMap((site) => [
  site.siteName,
  ...addressLines(site),
  site.country
])

/**
 * The work-item context rows management-fe appends to most entries' "Show
 * details" disclosure and leaves off this system correction, as it does for
 * `accreditation-number-corrected` (see ra-691).
 */
const CONTEXT_ROW_KEYS = [
  'Org ID',
  'Type',
  'State',
  'Submitted at',
  'Submitted by',
  'Last modified',
  'Assigned to'
]

function createExporterWithSites(organisationNamePrefix) {
  return createWorkItemViaApi({
    organisationNamePrefix,
    fields: (base) => {
      const { siteAddress, ...withoutSiteAddress } = base
      return {
        ...withoutSiteAddress,
        wasteProcessingType: 'exporter',
        // An exporter's regulator (and the application reference's postcode
        // segment) comes from its registered office.
        companyRegisterAddressPostcode: uniquePostcode('BS1'),
        companiesHouseNumber: '15975346',
        overseasSites: { sites: [siteA, siteB, siteC] }
      }
    }
  })
}

/** Every site is still listed: the refused correction changed nothing. */
async function assertAllSitesListed(workItemId) {
  await workItems.openWorkItem(workItemId)
  expect(await detail.overseasSiteNames()).toEqual([
    siteA.siteName,
    siteB.siteName,
    siteC.siteName
  ])
}

describe('RA-768 overseas sites corrected', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('a work item that is not duly made', () => {
    let workItemId
    let correction

    before(async () => {
      workItemId = (
        await createExporterWithSites('RA-768 Overseas Sites Corrected Ltd')
      ).id
      correction = await removeOverseasSitesViaApi(workItemId, {
        sites: REMOVE_B_AND_C,
        reason: REASON
      })
    })

    it('reports both sites removed, by their stored ids', async () => {
      expect(correction.status).toBe(200)
      expect(correction.body).toEqual({
        removed: [
          { orsId: siteB.orsId, siteId: String(siteB.siteId) },
          { orsId: null, siteId: String(siteC.siteId) }
        ],
        alreadyAbsent: []
      })
    })

    describe('the Application summary', () => {
      before(async () => {
        await workItems.openWorkItem(workItemId)
      })

      it('lists only the remaining overseas site', async () => {
        expect(await detail.overseasSiteNames()).toEqual([siteA.siteName])
      })

      it("keeps the remaining site's ORS ID and address", async () => {
        const ors = await detail.applicationDetailRowText('ors')
        expect(ors).toContain(siteA.orsId)
        for (const line of addressLines(siteA)) {
          expect(ors).toContain(line)
        }
      })

      it('lists only the remaining site in the BES evidence row', async () => {
        const sites = await detail.besSiteTexts()
        expect(sites).toHaveLength(1)
        expect(sites[0]).toContain(siteA.siteName)
      })

      it('shows the removed sites nowhere on the page', async () => {
        // Anchored on the remaining site, so a page that failed to render
        // cannot pass the absence checks.
        const page = await detail.pageText()
        expect(page).toContain(siteA.siteName)
        for (const text of REMOVED_SITE_TEXT) {
          expect(page).not.toContain(text)
        }
      })
    })

    describe('the Recycling operations tab', () => {
      before(async () => {
        await workItems.openWorkItem(workItemId)
        await recyclingOperations.gotoForCurrentWorkItem()
      })

      it('lists only the remaining site', async () => {
        expect(await recyclingOperations.siteCount()).toBe(1)
        expect(await recyclingOperations.hasSiteRow(siteA.siteId)).toBe(true)
        expect(await recyclingOperations.hasSiteRow(siteB.siteId)).toBe(false)
        expect(await recyclingOperations.hasSiteRow(siteC.siteId)).toBe(false)
      })

      it("keeps the remaining site's recycling operation codes", async () => {
        const labels = await detail.recyclingOperationsSiteCodeLabels(
          siteA.siteId
        )
        // Starts-with, as in ra-486: the label wording is management-fe's.
        expect(labels).toHaveLength(siteA.operationCodes.length)
        for (const code of siteA.operationCodes) {
          expect(labels.some((label) => label.startsWith(code))).toBe(true)
        }
      })
    })

    describe('Application history', () => {
      before(async () => {
        await workItems.openWorkItem(workItemId)
        await detail.gotoAudit()
        await detail.expandAllAuditEntryDetails()
      })

      it('shows one "Overseas sites corrected" entry', async () => {
        expect(await detail.auditEntryHeadings(ACTION)).toEqual([
          'Overseas sites corrected'
        ])
      })

      it('summarises the removed sites by ORS ID, or site ID without one', async () => {
        expect(await detail.auditEntrySummaryLines(ACTION)).toEqual([
          `Overseas sites corrected — ORS ID: ${siteB.orsId}, Site ID: ${siteC.siteId}`
        ])
      })

      it('lists the removed sites one per line, and the reason', async () => {
        expect(
          await detail.auditDetailRowParagraphs(
            ACTION,
            'Removed sites',
            siteB.orsId
          )
        ).toEqual([`ORS ID: ${siteB.orsId}`, `Site ID: ${siteC.siteId}`])
        await detail.assertAuditDetailRow(ACTION, 'Reason', REASON)
      })

      it('names no site and shows no work-item context rows', async () => {
        // No personal data: the entry carries ids only, never a site's name
        // or address. Scoped to this entry, because the submission's own
        // entry legitimately carries the submitted payload.
        const [entry] = await detail.auditEntryTexts(ACTION)
        expect(entry).toContain(siteB.orsId)
        for (const text of REMOVED_SITE_TEXT) {
          expect(entry).not.toContain(text)
        }
        await detail.assertNoAuditDetailRowKeys(ACTION, CONTEXT_ROW_KEYS)
      })
    })

    describe('repeating the correction', () => {
      let repeat

      before(async () => {
        repeat = await removeOverseasSitesViaApi(workItemId, {
          sites: REMOVE_B_AND_C,
          reason: REASON
        })
      })

      it('removes nothing and reports both sites already absent', async () => {
        expect(repeat.status).toBe(200)
        expect(repeat.body).toEqual({
          removed: [],
          alreadyAbsent: REMOVE_B_AND_C
        })
      })

      it('adds no second history entry', async () => {
        await workItems.openWorkItem(workItemId)
        await detail.gotoAudit()
        expect(await detail.auditEntryHeadings(ACTION)).toHaveLength(1)
      })

      it('still lists the remaining site', async () => {
        await workItems.openWorkItem(workItemId)
        expect(await detail.overseasSiteNames()).toEqual([siteA.siteName])
      })
    })
  })

  describe('a duly-made work item', () => {
    let workItemId
    let correction

    before(async () => {
      workItemId = (
        await createExporterWithSites('RA-768 Overseas Sites Duly Made Ltd')
      ).id
      await dulyMake(workItemId)
      correction = await removeOverseasSitesViaApi(workItemId, {
        sites: REMOVE_B_AND_C,
        reason: REASON
      })
    })

    it('is refused as duly made', async () => {
      expect(correction.status).toBe(409)
      expect(correction.body.reason).toBe('duly-made')
    })

    it('still lists every site', async () => {
      await assertAllSitesListed(workItemId)
    })

    it('records no correction in Application history', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      expect(await detail.auditEntryHeadings(ACTION)).toEqual([])
    })
  })

  describe('a decided (withdrawn) work item', () => {
    let workItemId
    let correction

    before(async () => {
      workItemId = (
        await createExporterWithSites('RA-768 Overseas Sites Withdrawn Ltd')
      ).id
      // Withdrawn straight from `submitted`, so it was never duly made and
      // the refusal can only be for the decision.
      await withdrawAsOperatorOrThrow(
        workItemId,
        'Withdrawn by the operator (test fixture)'
      )
      correction = await removeOverseasSitesViaApi(workItemId, {
        sites: REMOVE_B_AND_C,
        reason: REASON
      })
    })

    it('is refused as decided', async () => {
      expect(correction.status).toBe(409)
      expect(correction.body.reason).toBe('decided')
    })

    it('still lists every site', async () => {
      await assertAllSitesListed(workItemId)
      await detail.assertState('Withdrawn')
    })

    it('records no correction in Application history', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      expect(await detail.auditEntryHeadings(ACTION)).toEqual([])
    })
  })
})
