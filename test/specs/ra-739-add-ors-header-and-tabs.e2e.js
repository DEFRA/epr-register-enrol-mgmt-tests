import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItemDetail from '../page-objects/work-item-detail.page.js'
import workItems from '../page-objects/work-items.page.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'

/**
 * RA-739 / RA-495. An add-ORS application in Case Management has its own
 * header: the site name and ORS id as the title (the reference is in the
 * breadcrumb only), no organisation, and the meta items in the order
 * re-accreditation shares. The charge is the site's own. It has four
 * tabs (Application summary, Accreditation summary, Related applications,
 * Application history); Related applications is empty until RA-770 (the
 * Accreditation summary's content is `ra-769-accreditation-summary-tab`).
 * Every tab keeps the same header.
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

  // No caption: the breadcrumb already shows the reference.
  await expect(headerField('caption')).not.toExist()
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

  before(async () => {
    submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA495 Add ORS Header Ltd',
      siteCount: 2
    })
    await login.login()
    await workItems.openWorkItem(submission.workItems[0].id)
  })

  after(async () => {
    await login.logout()
  })

  describe('Application summary', () => {
    it('titles the header with the site, the reference only in the breadcrumb', async () => {
      await expect(workItemDetail.addOverseasSiteDetail()).toExist()
      await expectAddOrsHeader(submission)
    })

    it('shows the eight meta items, in the order re-accreditation shares, with the site charge', async () => {
      expect(await workItemDetail.caseHeaderMeta()).toEqual([
        'Application type: New ORS accreditation',
        'Status: Not started',
        'Assigned to: Unassigned',
        `Due date: ${EM_DASH}`,
        `Accreditation number: ${submission.payload.accreditationReference}`,
        'Material: Plastic',
        'Charge: £328.00',
        'Payment date: Not received'
      ])
    })

    it('shows the four add-ORS tabs, with Application summary active', async () => {
      expect(await workItemDetail.caseTabKeys()).toEqual(ADD_ORS_TAB_KEYS)
      expect(await workItemDetail.isActiveTab('summary')).toBe(true)
    })
  })

  for (const [name, tabKey, isEmpty] of [
    ['Accreditation summary', 'accreditationSummary', false],
    ['Related applications', 'relatedApplications', true]
  ]) {
    describe(name, () => {
      before(async () => {
        await workItems.openWorkItem(submission.workItems[0].id)
        await workItemDetail.gotoTab(tabKey)
      })

      it('keeps the add-ORS header', async () => {
        await expectAddOrsHeader(submission)
        await expect(headerField('accreditation-number')).toHaveText(
          submission.payload.accreditationReference
        )
      })

      it('is active among the four', async () => {
        expect(await workItemDetail.caseTabKeys()).toEqual(ADD_ORS_TAB_KEYS)
        expect(await workItemDetail.isActiveTab(tabKey)).toBe(true)
        await expect(await workItemDetail.emptyTabPanel(tabKey)).toExist()
      })

      if (isEmpty) {
        it('is an empty tab', async () => {
          const panel = await workItemDetail.emptyTabPanel(tabKey)
          expect((await panel.getText()).trim()).toBe('')
        })
      } else {
        it('has its own content, under the heading', async () => {
          await expect(workItemDetail.accreditationSummaryHeading()).toHaveText(
            'Accreditation Summary'
          )
        })
      }
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
