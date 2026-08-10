import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import withdraw from '../page-objects/withdraw.page.js'

/**
 * RA-313 AC01 — a withdrawn application is identifiable in the worklist.
 *
 * "Given an application has been withdrawn, when a regulator views the
 * applications worklist, then the application is displayed in the worklist
 * and the application status is shown as 'Withdrawn'."
 *
 * This file REPLACES ra-224-archived-items.e2e.js, which asserted the exact
 * opposite. RA-224 hid every terminal state (approved/rejected/withdrawn)
 * from the default worklist unless "Show archived" was ticked; it was closed
 * as incorrectly filed, so the hiding is gone and all three states come back
 * to the list. The three-item setup is kept from that spec because it is
 * still the cheapest way to prove the revert covers every terminal state, not
 * just the withdrawn one RA-313 names.
 *
 * A shared, unique org-name token scopes every assertion to the three items
 * this spec creates, so the presence checks stay pagination-safe even when
 * the list holds unrelated items from other specs.
 */
const token = `RA313Worklist${Date.now()}`

/**
 * Create a re-accreditation work item under the shared token and drive it
 * through its task journey to the Awaiting decision state, ready for a
 * decision-maker to approve or reject. Returns the work item id.
 */
async function driveToAwaitingDecision(suffix, material) {
  await login.login()
  await workItems.goto()
  const { id } = await workItems.createWorkItem({
    organisationName: `${token} ${suffix}`,
    siteAddressLine1: '1 Archive Street',
    siteAddressTown: 'York',
    siteAddressPostcode: 'YO1 2AE',
    material,
    tonnageBand: '0-500'
  })

  await workItems.openWorkItem(id)
  await detail.assertState('Not started')

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
  await detail.assertState('Updated')

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

describe('RA-313 terminal-state applications stay on the worklist', () => {
  let approvedId
  let rejectedId
  let withdrawnId

  it('drives a work item to the Withdrawn terminal state', async () => {
    await login.login()
    await workItems.goto()
    withdrawnId = (
      await workItems.createWorkItem({
        organisationName: `${token} Withdrawn`,
        siteAddressLine1: '1 Archive Street',
        siteAddressTown: 'York',
        siteAddressPostcode: 'YO1 2AF',
        material: 'glass',
        tonnageBand: '0-500'
      })
    ).id

    // RA-313 is about OPERATOR-initiated withdrawal, but this suite only
    // drives the case management UI — and both routes land the work item in
    // the same `withdrawn` state, which is all AC01 turns on. The CM-side
    // withdraw journey used here is RA-188's and is expected to be retired;
    // when it goes, seed the withdrawn state some other way rather than
    // dropping the assertions below.
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

    await login.login()
    await workItems.openWorkItem(rejectedId)
    await detail.assertState('Awaiting decision')
    await detail.gotoTasks()
    await detail.setTaskStatus('record-decision-rationale', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('reject')
    await detail.assertState('Refused')

    await login.logout()
  })

  it('drives a work item to the Approved terminal state', async () => {
    approvedId = await driveToAwaitingDecision('Approved', 'plastic')

    await login.login()
    await workItems.openWorkItem(approvedId)
    await detail.assertState('Awaiting decision')
    await detail.gotoTasks()
    await detail.setTaskStatus('record-decision-rationale', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('approve')
    await detail.submitApproval()
    await detail.assertState('Granted')

    await login.logout()
  })

  it('shows the withdrawn application on the default worklist as "Withdrawn"', async () => {
    // AC01 proper. No archived filter, no status filter — just the plain
    // worklist a regulator lands on, bounded by the org search so the
    // assertion is not at the mercy of pagination.
    await login.login()
    await workItems.goto()
    await workItems.searchByOrgName(token)

    await expect(workItems.workItemLink(withdrawnId)).toExist()
    await expect(workItems.workItemStateTag(withdrawnId)).toHaveText(
      expect.stringContaining('Withdrawn')
    )

    await login.logout()
  })

  it('shows the decided applications on the default worklist too', async () => {
    // The RA-224 revert is not withdrawn-only: a regulator looking for a
    // granted or refused application finds it where every other application
    // is. This is the case that used to assert "No work items match your
    // filters".
    await login.login()
    await workItems.goto()
    await workItems.searchByOrgName(token)

    await expect(workItems.workItemLink(rejectedId)).toExist()
    await expect(workItems.workItemLink(approvedId)).toExist()
    await expect(workItems.workItemStateTag(rejectedId)).toHaveText(
      expect.stringContaining('Refused')
    )
    await expect(workItems.workItemStateTag(approvedId)).toHaveText(
      expect.stringContaining('Granted')
    )

    await login.logout()
  })

  it('still lists them when "Show archived" is enabled', async () => {
    // `includeArchived` is now inert: nothing is hidden, so nothing is left
    // for it to reveal. Kept as a regression guard because the checkbox is
    // still on the Applications page (the UI was signed off against a
    // prototype and is deliberately untouched by RA-313 — see epr-kenf) and
    // ticking it must not start SUBTRACTING results.
    await login.login()
    await workItems.goto()
    await workItems.searchArchivedByOrgName(token)

    await expect(workItems.workItemLink(withdrawnId)).toExist()
    await expect(workItems.workItemLink(rejectedId)).toExist()
    await expect(workItems.workItemLink(approvedId)).toExist()

    await login.logout()
  })
})
