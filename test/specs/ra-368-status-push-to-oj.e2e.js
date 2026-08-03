import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-368 — CM pushes work item status changes to OJ.
 *
 * Every generic work-item transition now fires `WorkItemStatusPushHook`,
 * which calls OJ's `case-management/{workItemId}/status` endpoint and
 * records a `status-push-sent` audit entry (labelled "Status sent to OJ").
 * Two call sites matter here:
 *   - the submitted -> duly-made auto-transition, which bypasses the
 *     generic `WorkItemService.ApplyActionAsync` path and so needed the
 *     hook wired in explicitly (`ReAccreditationDulyMadeHook`);
 *   - an ordinary action (`payment-received`), which goes through the
 *     generic `ApplyActionAsync` path the hook is registered against.
 * Both must produce their own `status-push-sent` entry.
 */
describe('RA-368 CM status push to OJ', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: `Status Push ${Date.now()}`,
        siteAddressLine1: '1 Status Street',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1SP',
        material: 'plastic',
        tonnageBand: '0-500'
      })
    ).id
  })

  after(async () => {
    await login.logout()
  })

  it('records a status-push-sent entry for the auto duly-made transition', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.gotoTasks()
    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')
    await detail.gotoDetail()
    await detail.assertState('Duly made')

    await detail.gotoAudit()
    const sentEntries = await detail.auditEntriesForAction('status-push-sent')
    expect(sentEntries.length).toBe(1)
    await detail.assertAuditEntry('Status sent to OJ')
  })

  it('records a second status-push-sent entry for the payment-received action', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.gotoTasks()
    await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('payment-received')
    await detail.assertState('Updated')

    await detail.gotoAudit()
    const sentEntries = await detail.auditEntriesForAction('status-push-sent')
    expect(sentEntries.length).toBe(2)
  })
})
