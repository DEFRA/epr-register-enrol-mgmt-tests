import { browser, $, expect } from '@wdio/globals'
import login from './page-objects/LoginPage.js'
import workItems from './page-objects/WorkItemsPage.js'
import detail from './page-objects/WorkItemDetailPage.js'

let assignedWorkItemId
let progressedWorkItemId

describe('Assign user journey', () => {
  it('create two work items, assign one, progress the other through all stages', async () => {
    await login.loginAs('assign')
    expect(new URL(await browser.getUrl()).pathname).toBe('/')
    await expect($('.govuk-header__service-name')).toHaveText(
      expect.stringContaining('EPR Register Case Management')
    )

    // ── Create work item 1 (will be assigned to standard user) ─────────────────
    await workItems.goto()
    assignedWorkItemId = await workItems.createWorkItem({
      applicationReference: 'RA-TEST-ASSIGN-01',
      organisationName: 'Alpha Recycling Ltd',
      siteAddressLine1: '10 Assign Street',
      siteAddressTown: 'Manchester',
      siteAddressPostcode: 'M1 1AA',
      material: 'glass',
      tonnageBand: '0-500',
    })

    // ── Create work item 2 (will be progressed through stages) ────────────────
    await workItems.goto()
    progressedWorkItemId = await workItems.createWorkItem({
      applicationReference: 'RA-TEST-PROGRESS-02',
      organisationName: 'Beta Packaging Co',
      siteAddressLine1: '22 Progress Lane',
      siteAddressTown: 'Bristol',
      siteAddressPostcode: 'BS1 2BB',
      material: 'plastic',
      tonnageBand: '500-5000',
    })

    // ── Assign work item 1 to the standard user ───────────────────────────────
    await workItems.openWorkItem(assignedWorkItemId)
    await detail.assignTo('stub-standard-1')
    await detail.assertAssignedTo('Stub Standard User')

    // ── Progress work item 2 through stages ───────────────────────────────────
    await workItems.openWorkItem(progressedWorkItemId)

    await detail.assertState('Submitted')
    await detail.addNote('Work item received and under initial review.')

    await detail.assertTaskStatus('verify-organisation-details', 'Not started')
    await detail.assertTaskStatus('confirm-application-completeness', 'Not started')

    await detail.setTaskStatus('verify-organisation-details', 'InProgress')
    await detail.setTaskStatus('confirm-application-completeness', 'InProgress')
    await detail.addNote('Organisation details check underway. Application completeness being verified.')

    await detail.assertTaskStatus('verify-organisation-details', 'In progress')
    await detail.assertTaskStatus('confirm-application-completeness', 'In progress')

    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')
    await detail.addNote('All initial tasks completed. Ready for next stage.')

    await detail.assertTaskStatus('verify-organisation-details', 'Completed')
    await detail.assertTaskStatus('confirm-application-completeness', 'Completed')

    await login.logout()
  })
})

describe('Standard user journey', () => {
  it('find assigned work item, complete tasks, select Duly Made and progress through duly-made stage', async () => {
    await login.loginAs('standard')
    expect(new URL(await browser.getUrl()).pathname).toBe('/')

    // ── Navigate to work items and filter by "assigned to me" ─────────────────
    await workItems.goto()
    await $('input[name="assigneeMode"][value="mine"]').click()
    await $('[data-testid="work-items-filter-apply"]').click()

    await expect(workItems.workItemLink(assignedWorkItemId)).toBeDisplayed()
    await expect(workItems.workItemStateTag(assignedWorkItemId)).toHaveText(
      expect.stringContaining('Submitted')
    )

    await workItems.openWorkItem(assignedWorkItemId)
    await detail.assertState('Submitted')
    await detail.addNote('Standard user picked up work item for assessment.')

    await detail.assertTaskStatus('verify-organisation-details', 'Not started')
    await detail.assertTaskStatus('confirm-application-completeness', 'Not started')

    await detail.setTaskStatus('verify-organisation-details', 'InProgress')
    await detail.setTaskStatus('confirm-application-completeness', 'InProgress')
    await detail.addNote('Assessment started — reviewing organisation details and application completeness.')

    await detail.assertTaskStatus('verify-organisation-details', 'In progress')
    await detail.assertTaskStatus('confirm-application-completeness', 'In progress')

    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')
    await detail.addNote('Initial assessment complete. All tasks verified and signed off.')

    await detail.assertTaskStatus('verify-organisation-details', 'Completed')
    await detail.assertTaskStatus('confirm-application-completeness', 'Completed')

    // ── Select Duly Made ──────────────────────────────────────────────────────
    await detail.dulyMake()
    await detail.assertState('duly-made')
    await detail.addNote('Application marked as Duly Made. Proceeding to registration fee confirmation.')

    await detail.assertTaskStatus('confirm-registration-fee-paid', 'Not started')

    await detail.setTaskStatus('confirm-registration-fee-paid', 'InProgress')
    await detail.addNote('Confirming registration fee payment status.')

    await detail.assertTaskStatus('confirm-registration-fee-paid', 'In progress')

    await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
    await detail.addNote('Registration fee confirmed as paid. All duly-made tasks complete.')

    await detail.assertTaskStatus('confirm-registration-fee-paid', 'Completed')

    await login.logout()
  })
})
