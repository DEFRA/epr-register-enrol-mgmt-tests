import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItemDetail from '../page-objects/work-item-detail.page.js'
import workItems from '../page-objects/work-items.page.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'

/**
 * RA-739. An add-ORS application in Case Management has its own header, from
 * the Figma "Application page - Summary" frame: the application reference as
 * a caption, the site name and ORS id as the title, no organisation, and two
 * rows of four meta items (Request type, Status, Assigned to, Due date;
 * Material, Accreditation number, Charge, Payment date). The charge is the
 * site's own. It has only the Application summary and Application history
 * tabs, and Application history keeps the same header.
 *
 * Submitted straight to management-be, as the operator backend does.
 */

const EM_DASH = '—'

/**
 * A field of the case header, by its `case-header-{key}` test id. The
 * add-ORS fields (caption, title, request type, charge...) are not in the page
 * object's CASE_HEADER_FIELDS, which lists the fields every header carries.
 */
function headerField(key) {
  return workItemDetail.caseHeader().$(`[data-testid="case-header-${key}"]`)
}

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

describe('RA-739 add-ORS application header and tabs', () => {
  let submission

  before(async () => {
    submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA739 Add ORS Header Ltd',
      siteCount: 2
    })
    await login.login()
    await workItems.openWorkItem(submission.workItems[0].id)
  })

  after(async () => {
    await login.logout()
  })

  describe('Application summary', () => {
    it('captions the header with the reference and titles it with the site', async () => {
      await expect($('[data-testid="add-overseas-site-detail"]')).toExist()
      await expectAddOrsHeader(submission)
    })

    it('shows the eight meta items in Figma order, with the site charge', async () => {
      expect(await workItemDetail.caseHeaderMeta()).toEqual([
        'Request type: New ORS accreditation',
        'Status: Not started',
        'Assigned to: Unassigned',
        `Due date: ${EM_DASH}`,
        'Material: Plastic',
        `Accreditation number: ${submission.payload.accreditationReference}`,
        'Charge: £328',
        'Payment date: Not received'
      ])
    })

    it('shows only the Application summary and Application history tabs', async () => {
      expect(await workItemDetail.caseTabKeys()).toEqual([
        'application-summary',
        'application-history'
      ])
      expect(await workItemDetail.isActiveTab('summary')).toBe(true)
    })
  })

  describe('Application history', () => {
    before(async () => {
      await workItemDetail.gotoAudit()
    })

    it('keeps the add-ORS header', async () => {
      await expectAddOrsHeader(submission)
      await expect(headerField('request-type')).toHaveText(
        'New ORS accreditation'
      )
      await expect(headerField('charge')).toHaveText('£328')
    })

    it('shows the same two tabs, with Application history active', async () => {
      expect(await workItemDetail.caseTabKeys()).toEqual([
        'application-summary',
        'application-history'
      ])
      expect(await workItemDetail.isActiveTab('history')).toBe(true)
    })
  })
})
