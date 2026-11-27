import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItemDetail from '../page-objects/work-item-detail.page.js'
import workItems from '../page-objects/work-items.page.js'
import { submitUpdateOverseasSiteRequest } from '../support/in-year-change-api.js'
import { uniqueOrganisationName } from '../support/unique-name.js'

/**
 * RA-681. An ORS update request (`update-overseas-site`, RA-682) names its
 * request type from its site's `selected` flag, which the operator backend
 * sends: "Accreditation: ORS update" for an approved ORS, "Registration: ORS
 * update" for a registration-only one. The card shows the site line in place
 * of the registration number, and the detail page loads with the update's
 * header (the full update view is a later ticket).
 *
 * Two single-site update requests share an organisation name token, so an
 * organisation search lists exactly these two.
 */
describe('RA-681 ORS update request type', () => {
  const token = uniqueOrganisationName('RA681 ORS Update')
  const requests = {}

  before(async () => {
    for (const [scope, selected] of [
      ['Accreditation', true],
      ['Registration', false]
    ]) {
      const submission = await submitUpdateOverseasSiteRequest({
        organisationNamePrefix: `${token} ${scope}`,
        siteCount: 1,
        selected
      })
      requests[scope] = {
        id: submission.workItems[0].id,
        applicationReference: submission.workItems[0].applicationReference,
        site: submission.sites[0]
      }
    }
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  for (const scope of ['Accreditation', 'Registration']) {
    describe(`an update to ${scope === 'Accreditation' ? 'an approved' : 'a registration-only'} ORS`, () => {
      beforeEach(async () => {
        await workItems.resetFilters()
        await workItems.searchByOrg(token)
      })

      it(`reads "${scope}: ORS update" on its card, with the site line`, async () => {
        const { id, site } = requests[scope]

        await expect(workItems.tileField(id, 'request-type')).toHaveText(
          `Request type: ${scope}: ORS update`
        )
        await expect(workItems.tileField(id, 'application-site')).toHaveText(
          `${site.siteName} (${site.orsId})`
        )
        expect(await workItems.tileHasRegistrationNumber(id)).toBe(false)
      })

      it(`opens a detail page whose header reads "${scope}: ORS update"`, async () => {
        const { id, applicationReference, site } = requests[scope]

        await workItems.workItemLink(id).click()
        await expect(workItemDetail.updateOverseasSiteDetail()).toExist()
        await expect(
          workItemDetail.caseHeaderFieldByKey('request-type')
        ).toHaveText(`${scope}: ORS update`)
        await expect(
          workItemDetail.caseHeaderField('accreditationRef')
        ).toHaveText(applicationReference)
        await expect(workItemDetail.caseHeaderFieldByKey('title')).toHaveText(
          `${site.siteName} (${site.orsId})`
        )
        await expect(
          workItemDetail.caseHeaderFieldByKey('charge')
        ).not.toExist()
      })
    })
  }
})
