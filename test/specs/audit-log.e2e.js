import login from 'page-objects/login.page.js'
import workItems from 'page-objects/work-items.page.js'
import detail from 'page-objects/work-item-detail.page.js'

/** RA-175 - Audit Log validations
 *
 * Seeded work items include a submission record
 * The audit log includes a "Routed to nation" entry with a realistic timestamp and actor
 * Seeded work items include the applicant email address
 * Seeded work items appear in the work queue when the correct nation filter is applied
 * The nation field is correctly derived from postcode/country
 */

describe('RA-175 - Audit log validations', () => {
  let workItemId

  before(async () => {
    await login.loginAs('assign')
    await workItems.goto()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'Audit Test Organisation',
      siteAddressLine1: '1 Audit Street',
      siteAddressTown: 'London',
      siteAddressPostcode: 'SW1A 1AA',
      material: 'glass',
      tonnageBand: '0-500',
      operatorEmail: 'operator@example.com',
    }))
  })

  after(async () => {
    await login.logout()
  })

  it('audit log includes a "Routed to nation" entry', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.gotoAudit()
    await detail.assertAuditEntry('Routed to nation')
  })

  it('work item shows the applicant email address', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.assertOperatorEmail('operator@example.com')
  })

  it('work item appears in the work queue when filtering by nation', async () => {
    await workItems.goto()
    await workItems.filterByNation('England')
    await expect(workItems.workItemLink(workItemId)).toBeDisplayed()
  })
})
