import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItemDetail from '../page-objects/work-item-detail.page.js'
import workItems from '../page-objects/work-items.page.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'

/**
 * RA-495 AC3. An add-ORS application is assigned, reassigned and unassigned
 * through the same panel as a re-accreditation one, and each change is in
 * its Application history. (Changing the due date needs a duly made item, so
 * it belongs with the add-ORS duly make journey.)
 *
 * Submitted straight to management-be, as the operator backend does.
 */
describe('RA-495 add-ORS assignment and Application history', () => {
  before(async () => {
    const submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA495 Add ORS Assign Ltd',
      siteCount: 1
    })
    await login.login()
    await workItems.openWorkItem(submission.workItems[0].id)
  })

  after(async () => {
    await login.logout()
  })

  it('assigns the application to a caseworker without starting it', async () => {
    await workItemDetail.assertUnassigned()
    await workItemDetail.assignTo('stub-caseworker-2')
    await workItemDetail.assertAssignedTo('Stub Caseworker Two')
    await workItemDetail.assertState('Not started')
  })

  it('reassigns it to another caseworker', async () => {
    await workItemDetail.assignTo('stub-caseworker-3')
    await workItemDetail.assertAssignedTo('Stub Caseworker Three')
  })

  it('unassigns it', async () => {
    await workItemDetail.unassign()
    await workItemDetail.assertUnassigned()
  })

  it('records each change in Application history, newest first', async () => {
    await workItemDetail.gotoAudit()
    await workItemDetail.waitForAuditEntryCount('assigned', 2)
    await workItemDetail.waitForAuditEntryCount('unassigned', 1)

    expect(await workItemDetail.auditEntrySummaryLines('assigned')).toEqual([
      expect.stringContaining('Stub Caseworker Three'),
      expect.stringContaining('Stub Caseworker Two')
    ])
    expect(await workItemDetail.auditEntrySummaryLines('unassigned')).toEqual([
      expect.stringContaining('Stub Caseworker Three')
    ])
  })
})
