import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItemDetail from '../page-objects/work-item-detail.page.js'
import workItems from '../page-objects/work-items.page.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'

/**
 * RA-770. The Related change requests tab of an add-ORS case: its label
 * carries the number of requests in the submission on every tab; it shows the
 * accreditation (Accreditation number, Status, start date and year), then
 * "Related requests (n)": every request submitted with this one, ten to a
 * page, this request first, each reference linking to its own case above the
 * site name.
 *
 * Submitted straight to management-be, as the operator backend does
 * (ra-770-related-requests-journey covers a submission from the operator
 * journey).
 */

const TYPE = 'New ORS accreditation'
const CHARGE = '£328.00'

/** The row the tab shows for the submission's `index`th site. */
function expectedRow(submission, index) {
  const site = submission.sites[index]
  const workItem = submission.workItems[index]
  return {
    reference: workItem.applicationReference,
    link: `/work-items/${workItem.id}`,
    site: `${site.siteName} (${site.orsId})`,
    type: TYPE,
    charge: CHARGE,
    status: 'Not started'
  }
}

const tabText = () => workItemDetail.tab('relatedRequests').getText()

describe('RA-770 Related change requests tab', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('a submission of three requests', () => {
    let submission

    before(async () => {
      submission = await submitAddOverseasSiteRequest({
        organisationNamePrefix: 'RA770 Related Three Ltd',
        siteCount: 3
      })
      // The second request, so "this request first" is not reference order.
      await workItems.openWorkItem(submission.workItems[1].id)
    })

    it('labels the tab with the count on the other tabs too', async () => {
      expect(await tabText()).toBe('Related change requests (3)')
    })

    it('AC1: is active, under the add-ORS header', async () => {
      await workItemDetail.gotoRelatedRequests()
      expect(await workItemDetail.isActiveTab('relatedRequests')).toBe(true)
      expect(await tabText()).toBe('Related change requests (3)')
      await expect(workItemDetail.caseHeaderFieldByKey('title')).toHaveText(
        `${submission.sites[1].siteName} (${submission.sites[1].orsId})`
      )
    })

    it('AC1: shows the accreditation above the table', async () => {
      // management-be's stub accreditation for an `e2e-` test organisation,
      // as ra-769-accreditation-summary-tab asserts it.
      expect(await workItemDetail.relatedAccreditationRows()).toEqual([
        ['Accreditation number', 'A26ER9999999999PL'],
        ['Status', 'Granted'],
        ['Accreditation start date', '1 January 2026'],
        ['Accreditation year', '2026']
      ])
    })

    it('AC1: lists this request first, then the rest in reference order, each linked', async () => {
      await expect(workItemDetail.relatedRequestsHeading()).toHaveText(
        'Related requests (3)'
      )
      expect(await workItemDetail.relatedRequestsRows()).toEqual([
        expectedRow(submission, 1),
        expectedRow(submission, 0),
        expectedRow(submission, 2)
      ])
      await expect(workItemDetail.relatedRequestsPagination()).not.toExist()
    })

    it("AC3: a related request's reference opens its own case", async () => {
      const target = submission.workItems[0].id
      await $(
        `[data-testid="related-requests-reference"][href="/work-items/${target}"]`
      ).click()
      await browser.waitUntil(
        async () =>
          new URL(await browser.getUrl()).pathname === `/work-items/${target}`,
        { timeoutMsg: 'Expected the related request’s case to open' }
      )
      await expect(workItemDetail.caseHeaderFieldByKey('title')).toHaveText(
        `${submission.sites[0].siteName} (${submission.sites[0].orsId})`
      )
    })
  })

  describe('a submission of twelve requests', () => {
    let submission

    before(async () => {
      submission = await submitAddOverseasSiteRequest({
        organisationNamePrefix: 'RA770 Related Twelve Ltd',
        siteCount: 12
      })
      await workItems.openWorkItem(submission.workItems[4].id)
      await workItemDetail.gotoRelatedRequests()
    })

    it('AC2: shows ten on page 1, this request first', async () => {
      expect(await tabText()).toBe('Related change requests (12)')
      await expect(workItemDetail.relatedRequestsHeading()).toHaveText(
        'Related requests (12)'
      )
      const references = (await workItemDetail.relatedRequestsRows()).map(
        ({ reference }) => reference
      )
      expect(references).toEqual(
        [4, 0, 1, 2, 3, 5, 6, 7, 8, 9].map(
          (i) => submission.workItems[i].applicationReference
        )
      )
      await expect(workItemDetail.relatedRequestsPagination()).toExist()
    })

    it('AC2: the pagination moves to page 2, which holds the last two', async () => {
      await workItemDetail.nextRelatedRequestsPage()
      expect(await workItemDetail.relatedRequestsRows()).toEqual([
        expectedRow(submission, 10),
        expectedRow(submission, 11)
      ])
      expect(await workItemDetail.isActiveTab('relatedRequests')).toBe(true)
    })

    it('AC2: a request whose reference falls on page 2 is still first on page 1', async () => {
      await workItems.openWorkItem(submission.workItems[11].id)
      await workItemDetail.gotoRelatedRequests()
      expect(
        (await workItemDetail.relatedRequestsRows()).map(
          ({ reference }) => reference
        )
      ).toEqual(
        [11, 0, 1, 2, 3, 4, 5, 6, 7, 8].map(
          (i) => submission.workItems[i].applicationReference
        )
      )

      await workItemDetail.nextRelatedRequestsPage()
      expect(await workItemDetail.relatedRequestsRows()).toEqual([
        expectedRow(submission, 9),
        expectedRow(submission, 10)
      ])
    })
  })

  describe('a request submitted on its own', () => {
    let submission

    before(async () => {
      submission = await submitAddOverseasSiteRequest({
        organisationNamePrefix: 'RA770 Related Single Ltd',
        siteCount: 1
      })
      await workItems.openWorkItem(submission.workItems[0].id)
      await workItemDetail.gotoRelatedRequests()
    })

    it('AC4: lists only this request, with no pagination', async () => {
      expect(await tabText()).toBe('Related change requests (1)')
      await expect(workItemDetail.relatedRequestsHeading()).toHaveText(
        'Related requests (1)'
      )
      expect(await workItemDetail.relatedRequestsRows()).toEqual([
        expectedRow(submission, 0)
      ])
      await expect(workItemDetail.relatedRequestsPagination()).not.toExist()
    })
  })
})
