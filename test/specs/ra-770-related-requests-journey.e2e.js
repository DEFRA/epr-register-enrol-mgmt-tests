import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { getWorkItem } from '../support/decision-api.js'
import {
  DELHI,
  ROTTERDAM,
  describeIfMonorepoMongo,
  findInYearChangeAccreditation,
  resetInYearChangeOrganisation,
  submitAddOverseasSiteChangeRequest
} from '../support/operator-change-requests.js'

/**
 * RA-770. End to end from the operator journey: an operator adds two ORSs to
 * one change request on org 50019's seeded accreditation and submits it, the
 * operator backend raises one add-ORS work item per site under one
 * submission, and each case's Related change requests tab lists both, itself first.
 *
 * Runs only against the monorepo's root stack with MONOREPO_MONGO_URL set
 * (see support/operator-change-requests.js): it resets org 50019's change
 * requests, and their case-management work items, before and after. Nothing
 * is granted, so the reset only takes the two sites off the request again.
 * Don't run it alongside the other org 50019 specs.
 */

const BES_FILENAME = `ra770-bes-evidence-${Date.now()}.pdf`
const BES_CONTENT = `%PDF-1.4\nRA-770 BES evidence ${Date.now()}\n%%EOF\n`

describeIfMonorepoMongo(
  'RA-770: Related requests for a submission from the operator journey',
  () => {
    let applicationId
    let rotterdam
    let delhi

    const reset = async () => {
      await resetInYearChangeOrganisation({ siteId: ROTTERDAM.siteId })
      await resetInYearChangeOrganisation({
        siteId: DELHI.siteId,
        pristine: DELHI.pristine
      })
    }

    /** The row the tab shows for a work item. */
    const rowFor = (workItem) => ({
      reference: workItem.payload.applicationReference,
      link: `/work-items/${workItem.id}`,
      site: `${workItem.payload.site.siteName} (${workItem.payload.site.orsId})`
    })

    const visibleRows = async () =>
      (await detail.relatedRequestsRows()).map(({ reference, link, site }) => ({
        reference,
        link,
        site
      }))

    before(async function () {
      applicationId = await findInYearChangeAccreditation()
      if (!applicationId) {
        // Not the monorepo's root stack: no seeded in-year change accreditation.
        this.skip()
      }
      await reset()
      const request = await submitAddOverseasSiteChangeRequest({
        applicationId,
        site: ROTTERDAM,
        alsoSites: [
          {
            site: DELHI,
            answers: DELHI.answers,
            besEvidence: { filename: BES_FILENAME, content: BES_CONTENT }
          }
        ]
      })
      rotterdam = await getWorkItem(request.id)
      delhi = await getWorkItem(request.others[0].id)
      await login.login()
    })

    after(async () => {
      if (applicationId) {
        await reset()
        await login.logout()
      }
    })

    it('raises one work item per site under one submission', () => {
      expect(rotterdam.payload.submissionReference).toBeTruthy()
      expect(delhi.payload.submissionReference).toBe(
        rotterdam.payload.submissionReference
      )
    })

    it("lists both on the first site's tab, itself first", async () => {
      await workItems.openWorkItem(rotterdam.id)
      await detail.gotoRelatedRequests()

      expect(await detail.tab('relatedRequests').getText()).toBe(
        'Related change requests (2)'
      )
      await expect(detail.relatedRequestsHeading()).toHaveText(
        'Related requests (2)'
      )
      expect(await visibleRows()).toEqual([rowFor(rotterdam), rowFor(delhi)])
    })

    it("lists both on the second site's tab, itself first", async () => {
      await workItems.openWorkItem(delhi.id)
      await detail.gotoRelatedRequests()

      expect(await visibleRows()).toEqual([rowFor(delhi), rowFor(rotterdam)])
    })
  }
)
