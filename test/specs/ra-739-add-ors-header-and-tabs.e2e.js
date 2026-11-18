import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItemDetail from '../page-objects/work-item-detail.page.js'
import workItems from '../page-objects/work-items.page.js'
import {
  ADD_ORS_SUBMITTED_BY,
  submitAddOverseasSiteRequest
} from '../support/in-year-change-api.js'
import { formatUkHeaderDate } from '../support/uk-time.js'

/**
 * RA-739 / RA-495. An add-ORS application in Case Management has its own
 * header: the application reference as a caption, the site name and ORS id as
 * the title, no organisation, and three rows of four meta items (RA-495: the
 * ticket plus Figma "Flows 5"). The charge is the site's own. It has four
 * tabs (Application summary, Accreditation summary, Related applications,
 * Application history); Accreditation summary and Related applications are
 * empty until RA-769 and RA-770. Every tab keeps the same header.
 *
 * Submitted straight to management-be, as the operator backend does.
 */

const EM_DASH = '—'

const ADD_ORS_TAB_KEYS = [
  'application-summary',
  'accreditation-summary',
  'related-applications',
  'application-history'
]

const headerField = (key) => workItemDetail.caseHeaderFieldByKey(key)

async function expectAddOrsHeader(submission) {
  const [{ applicationReference }] = submission.workItems
  const [site] = submission.sites

  await expect(headerField('caption')).toHaveText(applicationReference)
  await expect(headerField('title')).toHaveText(
    `${site.siteName} (${site.orsId})`
  )
  await expect(headerField('applications-link')).toHaveText('Applications')
  await expect(headerField('accreditation-ref')).toHaveText(
    applicationReference
  )
  await expect(headerField('org-name')).not.toExist()
  await expect(headerField('org-id')).not.toExist()
  // Not the re-accreditation "Organisation (Org ID)" title. The site name
  // starts with the organisation name, so match the pair.
  expect(await workItemDetail.caseHeader().getText()).not.toContain(
    `${submission.organisationName} (${submission.operatorOrgNumber})`
  )
}

describe('RA-739 / RA-495 add-ORS application header and tabs', () => {
  let submission
  let dateAdded

  before(async () => {
    submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA495 Add ORS Header Ltd',
      siteCount: 2
    })
    dateAdded = formatUkHeaderDate(new Date())
    await login.login()
    await workItems.openWorkItem(submission.workItems[0].id)
  })

  after(async () => {
    await login.logout()
  })

  describe('Application summary', () => {
    it('captions the header with the reference and titles it with the site', async () => {
      await expect(workItemDetail.addOverseasSiteDetail()).toExist()
      await expectAddOrsHeader(submission)
    })

    it('shows the twelve meta items in ticket order, with the site charge', async () => {
      const [site] = submission.sites
      expect(await workItemDetail.caseHeaderMeta()).toEqual([
        'Change request type: New ORS accreditation',
        'Status: Not started',
        'Assigned to: Unassigned',
        `Due date: ${EM_DASH}`,
        `Location: ${site.townOrCity}, ${site.country}`,
        `Site ID: ${site.orsId}`,
        `Date added: ${dateAdded}`,
        `Submitted by: ${ADD_ORS_SUBMITTED_BY.fullName}`,
        'Material: Plastic',
        `Accreditation number: ${submission.payload.accreditationReference}`,
        'Charge: £328.00',
        'Payment date: Not received'
      ])
    })

    it('shows the four add-ORS tabs, with Application summary active', async () => {
      expect(await workItemDetail.caseTabKeys()).toEqual(ADD_ORS_TAB_KEYS)
      expect(await workItemDetail.isActiveTab('summary')).toBe(true)
    })
  })

  for (const [name, tabKey] of [
    ['Accreditation summary', 'accreditationSummary'],
    ['Related applications', 'relatedApplications']
  ]) {
    describe(name, () => {
      before(async () => {
        await workItems.openWorkItem(submission.workItems[0].id)
        await workItemDetail.gotoEmptyTab(tabKey)
      })

      it('keeps the add-ORS header', async () => {
        await expectAddOrsHeader(submission)
        await expect(headerField('site-id')).toHaveText(
          submission.sites[0].orsId
        )
      })

      it('is an empty tab, active among the four', async () => {
        expect(await workItemDetail.caseTabKeys()).toEqual(ADD_ORS_TAB_KEYS)
        expect(await workItemDetail.isActiveTab(tabKey)).toBe(true)
        const panel = await workItemDetail.emptyTabPanel(tabKey)
        await expect(panel).toExist()
        expect((await panel.getText()).trim()).toBe('')
      })
    })
  }

  describe('Application history', () => {
    before(async () => {
      await workItems.openWorkItem(submission.workItems[0].id)
      await workItemDetail.gotoAudit()
    })

    it('keeps the add-ORS header', async () => {
      await expectAddOrsHeader(submission)
      await expect(headerField('request-type')).toHaveText(
        'New ORS accreditation'
      )
      await expect(headerField('charge')).toHaveText('£328.00')
    })

    it('shows the same four tabs, with Application history active', async () => {
      expect(await workItemDetail.caseTabKeys()).toEqual(ADD_ORS_TAB_KEYS)
      expect(await workItemDetail.isActiveTab('history')).toBe(true)
    })
  })
})
