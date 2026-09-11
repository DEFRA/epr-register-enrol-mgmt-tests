import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { raiseQuery, resumeFromQuery } from '../support/query-resubmission.js'
import { dulyMake } from '../support/re-accreditation-journey.js'
import { uniquePostcode } from '../support/unique-postcode.js'

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
 */

const createSubmittedWorkItem = async (organisationName) => {
  await workItems.goto()
  return (
    await workItems.createWorkItem({
      organisationName,
      siteAddressLine1: '1 Overseas Query Street',
      siteAddressTown: 'London',
      siteAddressPostcode: uniquePostcode(),
      material: 'plastic',
      tonnageBand: '0-500'
    })
  ).id
}

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
    workItemId = await createSubmittedWorkItem(
      `RA-557 ORS Resubmit ${Date.now()}`
    )
  })

  after(async () => {
    await login.logout()
  })

  it('shows no overseas sites before any resubmission', async () => {
    await workItems.openWorkItem(workItemId)
    expect(await detail.overseasSiteCount()).toBe(0)
  })

  it('reflects an added overseas site after a resubmission', async () => {
    await raiseQuery(workItemId, {
      sections: ['overseas-reprocessing-sites'],
      reason: 'Please provide the overseas reprocessing site details.'
    })

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

    await raiseQuery(workItemId, {
      sections: ['overseas-reprocessing-sites'],
      reason:
        'Please confirm one of the overseas reprocessing sites has closed.'
    })

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
