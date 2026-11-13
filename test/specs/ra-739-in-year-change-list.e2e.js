import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItemDetail from '../page-objects/work-item-detail.page.js'
import workItems from '../page-objects/work-items.page.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'

/**
 * RA-739. An operator's request to add overseas reprocessing sites (ORSs)
 * reaches Case Management as one submission holding several sites.
 * management-be splits it into one application per ORS: each has its own
 * `IYC-ORS-{year}-{nnnnn}` application reference and all share one
 * `SUB-{year}-{nnnn}` submission reference. The Applications list shows each
 * as an in-year change card.
 *
 * Submitted straight to management-be, as the operator backend does.
 */
describe('RA-739 in-year change applications on the Applications list', () => {
  const year = new Date().getUTCFullYear()
  let submission

  before(async () => {
    submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA739 Add ORS Ltd',
      siteCount: 3
    })
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  it('creates one application per site, sharing one submission reference', () => {
    expect(submission.submissionReference).toMatch(
      new RegExp(String.raw`^SUB-${year}-\d{4,}$`)
    )
    expect(submission.workItems.map((item) => item.siteId)).toEqual(
      submission.sites.map((site) => site.siteId)
    )
    const references = submission.workItems.map(
      (item) => item.applicationReference
    )
    references.forEach((reference) =>
      expect(reference).toMatch(new RegExp(String.raw`^IYC-ORS-${year}-\d{5}$`))
    )
    expect(new Set(references).size).toBe(3)
  })

  describe('each application card', () => {
    before(async () => {
      // A bare landing defaults to "assigned to me" (RA-299), which would
      // hide these unassigned items.
      await workItems.resetFilters()
      await workItems.searchByOrgName(submission.organisationName)
    })

    it('lists all three applications', async () => {
      expect(await workItems.getTileCount()).toBe(3)
    })

    for (const index of [0, 1, 2]) {
      it(`shows site ${index + 1}'s own reference, the shared submission and its site`, async () => {
        const { id, applicationReference } = submission.workItems[index]
        const site = submission.sites[index]

        await expect(workItems.workItemLink(id)).toHaveText(
          applicationReference
        )
        await expect(
          workItems.tileField(id, 'submission-reference')
        ).toHaveText(`${submission.submissionReference} (3 requests)`)
        await expect(workItems.tileField(id, 'application-org')).toHaveText(
          `${submission.organisationName} (${submission.operatorOrgNumber}): Plastic (Exporter)`
        )
        await expect(workItems.tileField(id, 'application-site')).toHaveText(
          `${site.siteName} (${site.orsId})`
        )
        await expect(workItems.tileField(id, 'request-type')).toHaveText(
          'Request type: New ORS accreditation'
        )
        await expect(workItems.tileField(id, 'assigned-to')).toHaveText(
          'Unassigned'
        )
        await expect(workItems.tileField(id, 'submitted-on')).toHaveText(
          /^\d{1,2} [A-Z][a-z]+ \d{4}$/
        )
        await expect(workItems.workItemStateTag(id)).toHaveText('Not started')
      })
    }
  })

  describe('a single-site request', () => {
    let single

    before(async () => {
      single = await submitAddOverseasSiteRequest({
        organisationNamePrefix: 'RA739 Single ORS Ltd',
        siteCount: 1
      })
      await workItems.resetFilters()
      await workItems.searchByOrgName(single.organisationName)
    })

    it('shows the submission reference without a request count', async () => {
      const [{ id }] = single.workItems
      await expect(workItems.tileField(id, 'submission-reference')).toHaveText(
        single.submissionReference
      )
    })

    it('opens the application header', async () => {
      const [{ id, applicationReference }] = single.workItems
      await workItems.workItemLink(id).click()
      await expect(workItemDetail.addOverseasSiteDetail()).toExist()
      await expect(
        workItemDetail.caseHeaderField('accreditationRef')
      ).toHaveText(applicationReference)
      await expect(
        workItemDetail.caseHeaderFieldByKey('request-type')
      ).toHaveText('New ORS accreditation')
    })
  })
})
