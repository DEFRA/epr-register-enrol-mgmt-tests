import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  raiseQueryViaApi,
  resumeFromQuery
} from '../support/query-resubmission.js'
import { dulyMake } from '../support/re-accreditation-journey.js'
import { RA557_OVERSEAS_SITES_RESUBMIT_ORG_NAME } from '../support/ra-557-seed.js'

/**
 * RA-557 — Overseas reprocessing sites (ORS) removal not reflected on the
 * Case Management summary after a query resubmit.
 *
 * Root cause: `ReAccreditationResumeService.StampLatestSectionsAsync`
 * (management-be) wrote every resubmitted section into
 * `payload.latestSections.sections[...]`, and separately merged a fixed
 * allowlist of sections onto their canonical top-level payload field
 * (`s_canonicalPayloadFieldBySectionKey`) — but `"OverseasSites"` was
 * missing from that allowlist. The Application summary page renders ORS
 * only from `payload.overseasSites.sites`, so a resubmitted, reduced ORS
 * list was persisted but never surfaced: the site the operator had removed
 * kept showing.
 *
 * This spec drives the SAME work item through two query/resubmit cycles —
 * one while `submitted` (query-during-duly-making), one after `duly-made`
 * (query-during-duly-made) — to exercise both an addition and a removal
 * against a real "before" list, the way `dulyMake` (submitted OR the
 * post-resubmit `updated` state) is documented to support.
 *
 * The query itself is raised via `raiseQueryViaApi` (a direct call to
 * management-be's own `/query` endpoint) rather than through the query
 * page: `overseas-reprocessing-sites` is an EXPORTER-ONLY query section
 * (RA-367), gated both client-side (the checkbox is never rendered) and
 * server-side by management-fe's own query controller. management-be's own
 * validator carries no such restriction, so calling it directly is the
 * honest way to exercise the actual bug (a resubmitted ORS section failing
 * to merge onto payload.overseasSites).
 *
 * The work item itself has to be a seeded EXPORTER fixture
 * (`ra-557-seed.js`), not one created via "Create work item": that form has
 * no `wasteProcessingType` field, and the ORS row on the Application
 * summary page only renders at all for an exporter application (the same
 * gate as the query section above) — so a UI-created item could never show
 * the result even after a correct resubmission. The fixture is PRIVATE to
 * this spec (see `ra-557-seed.js`) because this spec mutates its lifecycle
 * state, which a shared fixture cannot safely tolerate under CI's parallel
 * spec execution.
 */

const siteA = {
  siteId: 1,
  orsId: 'ORS-2026-0557-A',
  siteName: 'Rotterdam RA-557 Site',
  siteAddress: '1 Havenstraat, Rotterdam',
  country: 'Netherlands'
}

const siteB = {
  siteId: 2,
  orsId: 'ORS-2026-0557-B',
  siteName: 'Hamburg RA-557 Site',
  siteAddress: '42 Hafenstrasse, Hamburg',
  country: 'Germany'
}

describe('RA-557 Overseas reprocessing sites reflect a query resubmit', () => {
  let workItemId

  before(async () => {
    await login.login()
    // A bare landing defaults to assigned-to-me (RA-299), which would hide
    // this unassigned seeded item — reset to an explicit empty filter so
    // the search is not implicitly assignee-scoped (same discipline as
    // ra-483-removed-overseas-site-hidden.e2e.js).
    await workItems.resetFilters()
    await workItems.searchByOrgName(RA557_OVERSEAS_SITES_RESUBMIT_ORG_NAME)
    // Bounding check: prove exactly one row matched before trusting "first"
    // to mean "the seeded fixture".
    expect(await workItems.getRowCount()).toBe(1)
    workItemId = await workItems.firstResultWorkItemId()
  })

  after(async () => {
    await login.logout()
  })

  it('shows no overseas sites before any resubmission', async () => {
    await workItems.openWorkItem(workItemId)
    expect(await detail.overseasSiteCount()).toBe(0)
  })

  it('reflects an added overseas site after a resubmission', async () => {
    await raiseQueryViaApi(workItemId, {
      sections: ['overseas-reprocessing-sites'],
      reason: 'Please provide the overseas reprocessing site details.'
    })
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Queried')

    await resumeFromQuery(workItemId, {
      sectionKeys: ['overseas-reprocessing-sites'],
      sections: {
        OverseasSites: { sites: [siteA, siteB] }
      }
    })

    await workItems.openWorkItem(workItemId)
    expect(await detail.overseasSiteCount()).toBe(2)
    expect(await detail.overseasSiteNames()).toEqual([
      siteA.siteName,
      siteB.siteName
    ])
  })

  it('reflects a removed overseas site after a second query and resubmission', async () => {
    // Advance to duly-made so a second query (query-during-duly-made) is
    // available — the app allows only one open query per lifecycle stage.
    await dulyMake(workItemId)

    await raiseQueryViaApi(workItemId, {
      sections: ['overseas-reprocessing-sites'],
      reason:
        'Please confirm one of the overseas reprocessing sites has closed.'
    })
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Queried')

    // The operator resubmits with siteB removed. Before the RA-557 fix, this
    // landed only in payload.latestSections and payload.overseasSites.sites
    // stayed stale at [siteA, siteB].
    await resumeFromQuery(workItemId, {
      sectionKeys: ['overseas-reprocessing-sites'],
      sections: {
        OverseasSites: { sites: [siteA] }
      }
    })

    await workItems.openWorkItem(workItemId)
    expect(await detail.overseasSiteCount()).toBe(1)
    expect(await detail.overseasSiteNames()).toEqual([siteA.siteName])
  })
})
