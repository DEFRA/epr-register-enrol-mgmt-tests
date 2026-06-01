import login from 'page-objects/login.page.js'
import workItems from 'page-objects/work-items.page.js'
import detail from 'page-objects/work-item-detail.page.js'

/**
 * RA-187 — the work item audit log page renders a single-row summary
 * table at the top with the columns: Org ID, Type, State, Submitted at,
 * Submitted by, Last modified, Assigned to. This spec creates a re-
 * accreditation work item, opens its audit log and asserts the table
 * contains the expected headings and the work item's envelope values.
 */
describe('RA-187 — audit log screen summary table', () => {
  let workItemId

  before(async () => {
    await login.loginAs('assign')
  })

  after(async () => {
    await login.logout()
  })

  it('renders the envelope details as a single-row table at the top of the audit log', async () => {
    await workItems.goto()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'RA-187 Audit Summary Ltd',
      siteAddressLine1: '187 Audit Lane',
      siteAddressTown: 'Bristol',
      siteAddressPostcode: 'BS1 2RA',
      material: 'plastic',
      tonnageBand: '0-500'
    }))

    await workItems.openWorkItem(workItemId)
    await detail.gotoAudit()

    await detail.assertAuditSummaryTable({
      id: workItemId,
      type: 'Re-accreditation',
      state: 'Submitted',
      assignedTo: 'Unassigned'
    })
  })
})
