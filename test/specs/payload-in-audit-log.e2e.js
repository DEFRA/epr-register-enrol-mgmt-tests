import login from 'page-objects/login.page.js'
import workItems from 'page-objects/work-items.page.js'
import detail from 'page-objects/work-item-detail.page.js'

/**
 * RA-186 — the JSON payload moved from the work item detail page into
 * the submitted entry of the audit log, and the Template version row
 * was removed from the detail summary list. This spec creates a work
 * item, confirms the detail page no longer renders the payload pre
 * block or the Template version row, then opens the audit log,
 * expands the work-item-submitted entry's disclosure and asserts the
 * Payload row contains the submitted organisation name.
 */
describe('RA-186 — payload lives in the submitted audit entry', () => {
  let workItemId
  const organisationName = 'Payload In Audit Log Ltd'

  before(async () => {
    await login.loginAs('assign')
  })

  after(async () => {
    await login.logout()
  })

  it('creates a work item, hides payload + template version on detail, exposes payload on the submitted audit entry', async () => {
    await workItems.goto()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName,
      siteAddressLine1: '186 Audit Lane',
      siteAddressTown: 'Bristol',
      siteAddressPostcode: 'BS1 1RA',
      material: 'plastic',
      tonnageBand: '0-500'
    }))

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Submitted')
    await detail.assertNoPayloadOrTemplateVersionOnDetail()

    await detail.gotoAudit()
    await detail.assertAuditEntry('Work item submitted')
    await detail.expandAllAuditEntryDetails()
    await detail.assertSubmittedAuditPayloadContains(organisationName)
    await detail.assertNoTemplateVersionOnAuditLog()
  })
})
