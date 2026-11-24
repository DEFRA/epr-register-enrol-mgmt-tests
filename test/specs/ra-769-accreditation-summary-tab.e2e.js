import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItemDetail from '../page-objects/work-item-detail.page.js'
import workItems from '../page-objects/work-items.page.js'
import {
  buildAddOverseasSiteRequest,
  postAddOverseasSiteRequest,
  submitAddOverseasSiteRequest
} from '../support/in-year-change-api.js'
import { expectStatus } from '../support/backend-api.js'

/**
 * RA-769. The Accreditation summary tab of an In-Year Change case shows the
 * accreditation as it stands today, read live. These cases are posted
 * straight to management-be for an `e2e-` test organisation, which has no
 * operator data (and no accreditation application id), so management-be
 * answers from its stable test accreditation (ADR-0009, the stub in
 * `TestOrganisationAccreditationSummary`). The end-to-end journey from the
 * operator journey is ra-769-accreditation-summary-journey.
 *
 * Needs `TestOrganisations__Enabled` on in management-be, as the compose
 * stack has it.
 */

const INTRO =
  'A summary of the accreditation as it stands today. The changes in this request are not included until the request is granted.'
const UNAVAILABLE = 'Accreditation summary is not available at the moment.'

// The stub's fixed accreditation. The start date is 1 January of its year.
const STUB_ROWS = [
  ['Organisation', 'E2E Test Organisation Ltd (500999)'],
  ['Accreditation number', 'A26ER9999999999PL'],
  ['Status', 'Granted'],
  ['Accreditation year', '2026'],
  ['Accreditation start date', '1 January 2026'],
  ['Registration number', 'R26ER9999999999PL'],
  // An exporter shows its registered address as the location.
  ['Location', '2 Registered Road, Testville, TE2 2ST'],
  ['Type', 'Exporter accreditation'],
  ['Material', 'Plastic'],
  ['PRN tonnage', 'Up to 5,000 tonnes'],
  [
    'PRN authorisers',
    'Ada Authoriser (ada.authoriser@example.test) Bob Signer (bob.signer@example.test)'
  ],
  ['Authority to issue', 'Ada Authoriser Bob Signer'],
  [
    'Business plan',
    'New infrastructure — 60% of PRN income A new sorting line Price support — 40% of PRN income Support for collection prices'
  ]
]

const SAMPLING_PLAN_LABEL = 'Sampling and inspection plan'
const BES_LABEL = 'Broadly Equivalent Standards (BES)'
const ORS_LABEL = 'Overseas Reprocessing Site (ORS)'
const SAMPLING_CLEAN = 'e2e-sampling-plan-clean'

const downloadPath = (workItemId, fileId) =>
  `/work-items/${workItemId}/accreditation-summary/files/${fileId}/download`

const fullSiteRows = (orsId) => [
  ['ORS ID', orsId],
  ['Coordinates', '51.847,7.123'],
  ['Contact name', `Test Contact ${orsId}`],
  ['Contact email', `contact.${orsId}@example.test`],
  ['Contact phone number', '+44 20 7946 0000'],
  ['Operation code', 'R4'],
  ['Basel/OECD codes', 'B1010, B1020'],
  ['Repatriated loads', 'As per article 18'],
  ['Conditions of export', 'Yes'],
  ['EU country', 'Yes'],
  ['OECD country', 'Yes']
]

// The stub's four sites, in ORS ID order. The first two share a name, so only
// they show an address in the summary. The last has no contact, coordinates or
// codes, so those rows are left out.
const STUB_SITES = [
  {
    number: '001',
    name: 'Speira GmbH',
    summaryAddress: '1 Hafenstrasse, Germany',
    address: '1 Hafenstrasse, Bremen, Germany',
    rows: fullSiteRows('001')
  },
  {
    number: '002',
    name: 'Speira GmbH',
    summaryAddress: '2 Hafenstrasse, Germany',
    address: '2 Hafenstrasse, Hamburg, Germany',
    rows: fullSiteRows('002')
  },
  {
    number: '003',
    name: 'Excel Recycling BV',
    summaryAddress: '',
    address: '3 Havenweg, Rotterdam, Netherlands',
    rows: fullSiteRows('003')
  },
  {
    number: '004',
    name: 'Fox Reprocessing Inc',
    summaryAddress: '',
    address: '4 Harbour Road, Halifax, Canada',
    rows: [
      ['ORS ID', '004'],
      ['Conditions of export', 'No'],
      ['EU country', 'No'],
      ['OECD country', 'Yes']
    ]
  }
]

// The stub's interim sites, by site: one, three, none, none. Which of them
// the page shows depends on management-fe's MULTIPLE_INTERIM_SITES_ENABLED
// (see the interim sites tests below).
const interim = (id, number, name, codes) => ({
  name,
  address: `${id} Interim Strasse, Hamburg, 20095, Germany`,
  rows: [
    ['Site number', number],
    ['Contact name', `Interim Contact ${number}`],
    ['Contact email', `interim.${number.toLowerCase()}@example.test`],
    ['Contact phone number', '+49 40 1234 5678'],
    ['Operation code', codes]
  ]
})
const STUB_INTERIM_SITES = [
  [interim(101, 'I-001', 'Bremen Interim Works', 'R12')],
  [
    interim(201, 'I-002', 'Hamburg Interim North', 'R12'),
    interim(202, 'I-003', 'Hamburg Interim South', 'R13'),
    interim(203, 'I-004', 'Hamburg Interim East', 'R12 R3')
  ],
  [],
  []
]

const ADD_ORS_TAB_KEYS = [
  'application-summary',
  'accreditation-summary',
  'related-applications',
  'application-history'
]

describe('RA-769 Accreditation summary tab', () => {
  let submission

  before(async () => {
    submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA769 Accreditation Summary Ltd',
      siteCount: 1
    })
    await login.login()
    await workItems.openWorkItem(submission.workItems[0].id)
    await workItemDetail.gotoAccreditationSummary()
  })

  after(async () => {
    await login.logout()
  })

  it('is the active tab, under the add-ORS case header and tabs', async () => {
    expect(await workItemDetail.caseTabKeys()).toEqual(ADD_ORS_TAB_KEYS)
    expect(await workItemDetail.isActiveTab('accreditationSummary')).toBe(true)
    await expect(workItemDetail.caseHeaderFieldByKey('title')).toHaveText(
      `${submission.sites[0].siteName} (${submission.sites[0].orsId})`
    )
  })

  it('shows the heading, then the intro', async () => {
    await expect(workItemDetail.accreditationSummaryHeading()).toHaveText(
      'Accreditation Summary'
    )
    await expect(workItemDetail.accreditationSummaryIntro()).toHaveText(INTRO)
    await expect(workItemDetail.accreditationSummaryUnavailable()).not.toExist()
  })

  it('lists the accreditation details in order', async () => {
    const rows = await workItemDetail.accreditationSummaryRows()
    // The documents and the ORS row are asserted on their own below.
    const labels = rows.map(([label]) => label)
    expect(labels.slice(labels.indexOf('Authority to issue'))).toEqual([
      'Authority to issue',
      SAMPLING_PLAN_LABEL,
      'Business plan',
      BES_LABEL,
      ORS_LABEL
    ])
    expect(
      rows.filter(
        ([label]) =>
          ![SAMPLING_PLAN_LABEL, BES_LABEL, ORS_LABEL].includes(label)
      )
    ).toEqual(STUB_ROWS)
  })

  it('lists the sampling and inspection plan, linking only the file that has passed its scan', async () => {
    expect(
      await workItemDetail.accreditationSummaryDocuments(
        'sampling-inspection-plan'
      )
    ).toEqual([
      {
        text: 'sampling-and-inspection-plan.pdf',
        href: downloadPath(submission.workItems[0].id, SAMPLING_CLEAN)
      },
      { text: 'sampling-plan-awaiting-scan.pdf', href: null }
    ])
  })

  it('lists each site in the BES row with its country and evidence files', async () => {
    const sites = await workItemDetail.accreditationSummaryBesSites()
    const id = submission.workItems[0].id
    expect(sites).toEqual([
      {
        name: 'Speira GmbH',
        country: 'Germany',
        documents: [
          {
            text: 'bes-speira-bremen.pdf',
            href: downloadPath(id, 'e2e-bes-001')
          }
        ]
      },
      {
        name: 'Speira GmbH',
        country: 'Germany',
        documents: [
          {
            text: 'bes-speira-hamburg.pdf',
            href: downloadPath(id, 'e2e-bes-002')
          },
          { text: 'bes-speira-hamburg-awaiting-scan.pdf', href: null }
        ]
      },
      { name: 'Excel Recycling BV', country: 'Netherlands', documents: [] },
      { name: 'Fox Reprocessing Inc', country: 'Canada', documents: [] }
    ])
  })

  it('never puts an S3 key or bucket on the page', async () => {
    const source = await browser.getPageSource()
    expect(source).not.toContain('e2e-stub-bucket')
    expect(source).not.toContain('e2e-stub/')
    expect(source).not.toContain('s3Key')
  })

  // The stub's S3 locations are made up, so a clean stub file cannot be
  // streamed: its download reaches S3, fails, and serves nothing. The success
  // path is covered by management-fe's route tests.
  describe('downloads', () => {
    let id

    // Fetched from the page, so the request carries the caseworker's session.
    const statusOf = (path) =>
      browser.execute(async (url) => (await fetch(url)).status, path)

    before(() => {
      id = submission.workItems[0].id
    })

    it('serves nothing for a clean file when S3 has no such object', async () => {
      expect(await statusOf(downloadPath(id, SAMPLING_CLEAN))).toBe(404)
      expect(await statusOf(downloadPath(id, 'e2e-bes-001'))).toBe(404)
    })

    it('refuses a file that has not passed its scan with 422', async () => {
      expect(
        await statusOf(downloadPath(id, 'e2e-sampling-plan-pending'))
      ).toBe(422)
      expect(await statusOf(downloadPath(id, 'e2e-bes-002-pending'))).toBe(422)
    })

    it('answers 404 for a file that is not in the live summary', async () => {
      expect(await statusOf(downloadPath(id, 'not-in-the-summary'))).toBe(404)
    })

    it('does not serve a stub file from the payload-based download route', async () => {
      expect(
        await statusOf(`/work-items/${id}/files/${SAMPLING_CLEAN}/download`)
      ).toBe(404)
    })

    it('answers 404 for an unknown case', async () => {
      expect(
        await statusOf(
          downloadPath('00000000-0000-4000-8000-000000000000', SAMPLING_CLEAN)
        )
      ).toBe(404)
    })
  })

  it('shows PRN authorisers with their emails and Authority to issue as names only', async () => {
    expect(
      await workItemDetail.accreditationSummaryLines('prn-authorisers')
    ).toEqual([
      'Ada Authoriser (ada.authoriser@example.test)',
      'Bob Signer (bob.signer@example.test)'
    ])
    expect(
      await workItemDetail.accreditationSummaryLines('authority-to-issue')
    ).toEqual(['Ada Authoriser', 'Bob Signer'])
  })

  it('shows each business plan category with its share of PRN income', async () => {
    expect(
      await workItemDetail.accreditationSummaryPairs('business-plan')
    ).toEqual([
      'New infrastructure — 60% of PRN income A new sorting line',
      'Price support — 40% of PRN income Support for collection prices'
    ])
  })

  it('lists every site collapsed on load, each summary with its number and name, and the address only where a name repeats', async () => {
    expect(await workItemDetail.accreditationSummaryOrsSummaries()).toEqual(
      STUB_SITES.map(({ number, name, summaryAddress }) => ({
        open: false,
        number,
        name,
        address: summaryAddress
      }))
    )
  })

  it('shows the full address and the details of an expanded site, without the Registered row', async () => {
    for (const [index, site] of STUB_SITES.entries()) {
      const shown = await workItemDetail.accreditationSummaryOrsDetails(index)
      expect(shown.address).toBe(site.address)
      expect(shown.rows).toEqual(site.rows)
    }
    expect(await $('main').getText()).not.toContain(
      'Registered, now seeking accreditation'
    )
  })

  // Interim sites follow management-fe's MULTIPLE_INTERIM_SITES_ENABLED. The
  // mgmt-tests compose stack defaults it on, the root stack and the CDP test
  // baseline have it off, so the page says which it is: the count label only
  // exists with it on, and the second stub site has several interim sites.
  // When the runner states the flag, the page must agree.
  describe('interim sites', () => {
    let multipleInterimSitesEnabled

    // The parent suite's tests have finished by now, the last of them on
    // another tab, and the page it left has no sections open.
    before(async () => {
      await workItemDetail.gotoAccreditationSummary()
    })

    it('reads the flag state from the page, and agrees with the runner when it states one', async () => {
      // Read without opening anything, so the next test finds them collapsed.
      const sections = await workItemDetail.accreditationSummaryOrsSections()
      multipleInterimSitesEnabled = await sections[1]
        .$('[data-testid="interim-sites-label"]')
        .isExisting()
      const stated = process.env.MULTIPLE_INTERIM_SITES_ENABLED
      if (stated !== undefined && stated !== '') {
        expect(multipleInterimSitesEnabled).toBe(stated === 'true')
      }
    })

    it('flag on: lists every active interim site with a count, each collapsed; flag off: only the first, open', async () => {
      for (const index of [0, 1]) {
        const expected = STUB_INTERIM_SITES[index]
        const shown =
          await workItemDetail.accreditationSummaryInterimSites(index)
        expect(shown.none).toBeNull()
        if (multipleInterimSitesEnabled) {
          expect(shown.label).toBe(`Interim sites (${expected.length})`)
          expect(shown.sites.map(({ open }) => open)).toEqual(
            expected.map(() => false)
          )
          expect(shown.sites.map(({ open, ...rest }) => rest)).toEqual(expected)
        } else {
          expect(shown.label).toBeNull()
          expect(shown.sites.map(({ open }) => open)).toEqual([true])
          expect(shown.sites.map(({ open, ...rest }) => rest)).toEqual([
            expected[0]
          ])
        }
      }
    })

    it('says "No interim sites" for a site with none, in either flag state', async () => {
      for (const index of [2, 3]) {
        const shown =
          await workItemDetail.accreditationSummaryInterimSites(index)
        expect(shown.none).toBe('No interim sites')
        expect(shown.label).toBeNull()
        expect(shown.sites).toEqual([])
      }
    })

    it('keeps the site details free of its interim sites', async () => {
      const shown = await workItemDetail.accreditationSummaryOrsDetails(1)
      expect(shown.rows).toEqual(STUB_SITES[1].rows)
    })
  })

  it('shows the status as a green Granted tag', async () => {
    const tag = workItemDetail
      .accreditationSummaryValue('status')
      .$('.govuk-tag')
    await expect(tag).toHaveText('GRANTED', { ignoreCase: true })
    await expect(tag).toHaveElementClass('govuk-tag--green')
  })

  it('has no assignment panel and no case actions on the tab', async () => {
    await expect($('[data-testid="case-assignment-panel"]')).not.toExist()
    const panelText = await workItemDetail.accreditationSummaryPanel().getText()
    for (const action of ['Assign', 'Duly make', 'Query']) {
      expect(panelText).not.toContain(action)
    }
    expect(await $('main').getText()).not.toContain('NEW:')
  })

  it('keeps Related applications as its placeholder', async () => {
    await workItemDetail.gotoEmptyTab('relatedApplications')
    const panel = await workItemDetail.emptyTabPanel('relatedApplications')
    expect((await panel.getText()).trim()).toBe('')
  })
})

describe('RA-769 Accreditation summary tab with nothing to show', () => {
  let submission

  before(async () => {
    // A registration-only case: for a real (not `e2e-`) organisation and
    // with no accreditation application id, there is no accreditation.
    const request = buildAddOverseasSiteRequest({
      organisationNamePrefix: 'RA769 Registration Only Ltd',
      siteCount: 1
    })
    request.payload.operatorOrganisationId = `org-${request.payload.operatorRequestId}`
    const { body } = expectStatus(
      await postAddOverseasSiteRequest(request.payload),
      201,
      'submit a registration-only add-ORS request'
    )
    submission = { ...request, workItems: body.workItems }
    await login.login()
    await workItems.openWorkItem(submission.workItems[0].id)
    await workItemDetail.gotoAccreditationSummary()
  })

  after(async () => {
    await login.logout()
  })

  it('says the summary is not available, in place of the intro and rows', async () => {
    await expect(workItemDetail.accreditationSummaryHeading()).toHaveText(
      'Accreditation Summary'
    )
    await expect(workItemDetail.accreditationSummaryUnavailable()).toHaveText(
      UNAVAILABLE
    )
    await expect(workItemDetail.accreditationSummaryIntro()).not.toExist()
    expect(await workItemDetail.accreditationSummaryRows()).toEqual([])
  })

  it('keeps the case header and the tabs', async () => {
    expect(await workItemDetail.caseTabKeys()).toEqual(ADD_ORS_TAB_KEYS)
    expect(await workItemDetail.isActiveTab('accreditationSummary')).toBe(true)
    await expect(workItemDetail.caseHeaderFieldByKey('title')).toHaveText(
      `${submission.sites[0].siteName} (${submission.sites[0].orsId})`
    )
  })
})
