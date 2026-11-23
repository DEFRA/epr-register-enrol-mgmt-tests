import { $, expect } from '@wdio/globals'
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
 * operator journey is RA-769 task 008.
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
  ['Material', 'Plastic']
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
    expect(await workItemDetail.accreditationSummaryRows()).toEqual(STUB_ROWS)
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
