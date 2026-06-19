import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import withdraw from '../page-objects/withdraw.page.js'

/**
 * RA-224 — All end states are archived.
 *
 * Previously only `approved` work items were hidden from the active
 * worklist; `rejected` and `withdrawn` items stayed visible. This spec
 * proves that EVERY terminal state (approved, rejected, withdrawn) is now
 * excluded from the default list and surfaced only when the "Show
 * archived" filter is enabled.
 *
 * A shared, unique org-name token scopes every assertion to the three
 * items this spec creates, so the "hidden" check returns zero results and
 * the "revealed" check is pagination-safe even when the archived view
 * holds unrelated items from other specs.
 */
const token = `RA224Archive${Date.now()}`

/**
 * Create a re-accreditation work item under the shared token and drive it
 * through its task journey to the Awaiting decision state, ready for a
 * decision-maker to approve or reject. Returns the work item id.
 */
async function driveToAwaitingDecision(suffix, material) {
  await login.loginAs('assign')
  await workItems.goto()
  const { id } = await workItems.createWorkItem({
    organisationName: `${token} ${suffix}`,
    siteAddressLine1: '1 Archive Street',
    siteAddressTown: 'York',
    siteAddressPostcode: 'YO1 1AA',
    material,
    tonnageBand: '0-500'
  })

  await workItems.openWorkItem(id)
  await detail.assertState('Submitted')

  // Submitted -> Duly made (auto-transition on last submitted task).
  await detail.gotoTasks()
  await detail.setTaskStatus('verify-organisation-details', 'Completed')
  await detail.setTaskStatus('confirm-application-completeness', 'Completed')
  await detail.gotoDetail()
  await detail.assertState('Duly made')

  // Duly made -> Assessment in progress.
  await detail.gotoTasks()
  await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
  await detail.gotoDetail()
  await detail.triggerAction('payment-received')
  await detail.assertState('Assessment in progress')

  // Assessment in progress -> Awaiting decision.
  await detail.gotoTasks()
  await detail.setTaskStatus('review-compliance-history', 'Completed')
  await detail.setTaskStatus('assess-technical-capacity', 'Completed')
  await detail.setTaskStatus('assess-financial-capacity', 'Completed')
  await detail.gotoDetail()
  await detail.triggerAction('submit-for-decision')
  await detail.assertState('Awaiting decision')

  await login.logout()
  return id
}

describe('RA-224 all terminal states are archived', () => {
  let approvedId
  let rejectedId
  let withdrawnId

  it('drives a work item to the Withdrawn terminal state', async () => {
    await login.loginAs('assign')
    await workItems.goto()
    withdrawnId = (
      await workItems.createWorkItem({
        organisationName: `${token} Withdrawn`,
        siteAddressLine1: '1 Archive Street',
        siteAddressTown: 'York',
        siteAddressPostcode: 'YO1 1AA',
        material: 'glass',
        tonnageBand: '0-500'
      })
    ).id

    await workItems.openWorkItem(withdrawnId)
    await detail.triggerAction('withdraw')
    await withdraw.assertOnConfirmPage()
    await withdraw.submit()
    await withdraw.waitForDetailUrl(withdrawnId)
    await detail.assertState('Withdrawn')

    await login.logout()
  })

  it('drives a work item to the Rejected terminal state', async () => {
    rejectedId = await driveToAwaitingDecision('Rejected', 'paper')

    await login.loginAs('decision-maker')
    await workItems.openWorkItem(rejectedId)
    await detail.assertState('Awaiting decision')
    await detail.gotoTasks()
    await detail.setTaskStatus('record-decision-rationale', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('reject')
    await detail.assertState('Rejected')

    await login.logout()
  })

  it('drives a work item to the Approved terminal state', async () => {
    approvedId = await driveToAwaitingDecision('Approved', 'plastic')

    await login.loginAs('decision-maker')
    await workItems.openWorkItem(approvedId)
    await detail.assertState('Awaiting decision')
    await detail.gotoTasks()
    await detail.setTaskStatus('record-decision-rationale', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('approve')
    await detail.submitApproval()
    await detail.assertState('Approved')

    await login.logout()
  })

  it('hides every terminal-state item from the default worklist', async () => {
    await login.loginAs('assign')
    await workItems.goto()

    // Searching the shared token without the archived filter must return
    // nothing — all three items are in a terminal state and therefore
    // excluded from the active worklist.
    await workItems.searchByOrgName(token)
    await expect($('[data-testid="work-items-summary"]')).toHaveText(
      expect.stringContaining('No work items match your filters')
    )
    await expect(workItems.workItemLink(withdrawnId)).not.toBeExisting()
    await expect(workItems.workItemLink(rejectedId)).not.toBeExisting()
    await expect(workItems.workItemLink(approvedId)).not.toBeExisting()

    await login.logout()
  })

  it('reveals every terminal-state item under "Show archived" with its state tag', async () => {
    await login.loginAs('assign')
    await workItems.goto()

    // Enabling "Show archived" alongside the org-name search must surface
    // all three terminal-state items, each with its own state tag.
    await workItems.searchArchivedByOrgName(token)

    await expect(workItems.workItemLink(withdrawnId)).toExist()
    await expect(workItems.workItemLink(rejectedId)).toExist()
    await expect(workItems.workItemLink(approvedId)).toExist()

    await expect(workItems.workItemStateTag(withdrawnId)).toHaveText(
      expect.stringContaining('Withdrawn')
    )
    await expect(workItems.workItemStateTag(rejectedId)).toHaveText(
      expect.stringContaining('Rejected')
    )
    await expect(workItems.workItemStateTag(approvedId)).toHaveText(
      expect.stringContaining('Approved')
    )

    await login.logout()
  })
})
