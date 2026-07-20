import { browser, $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

let assignedWorkItemId
let progressedWorkItemId

describe('Assign user journey', () => {
  it('create two work items, assign one, progress the other through all stages', async () => {
    await login.login()
    expect(new URL(await browser.getUrl()).pathname).toBe('/work-items')
    // The service name moved from the header to the service navigation
    // component in govuk-frontend v6, so accept either rendering.
    await expect(
      $('.govuk-header__service-name, .govuk-service-navigation__service-name')
    ).toHaveText(expect.stringContaining('Packaging waste applications'))

    // ── Create work item 1 (will be assigned to another caseworker) ────────────
    await workItems.goto()
    ;({ id: assignedWorkItemId } = await workItems.createWorkItem({
      organisationName: 'Alpha Recycling Ltd',
      siteAddressLine1: '10 Assign Street',
      siteAddressTown: 'Manchester',
      siteAddressPostcode: 'M1 2AC',
      material: 'glass',
      tonnageBand: '0-500'
    }))

    // ── Create work item 2 (will be progressed through stages) ────────────────
    await workItems.goto()
    ;({ id: progressedWorkItemId } = await workItems.createWorkItem({
      organisationName: 'Beta Packaging Co',
      siteAddressLine1: '22 Progress Lane',
      siteAddressTown: 'Bristol',
      siteAddressPostcode: 'BS1 2BB',
      material: 'plastic',
      tonnageBand: '500-5000'
    }))

    // ── Assign work item 1 to another caseworker ──────────────────────────────
    await workItems.openWorkItem(assignedWorkItemId)
    await detail.assignTo('stub-caseworker-1')
    await detail.assertAssignedTo('Stub Caseworker One')

    // ── Progress work item 2 through stages ───────────────────────────────────
    await workItems.openWorkItem(progressedWorkItemId)

    await detail.assertState('Submitted')

    // Task controls live on the /tasks sub-page
    await detail.gotoTasks()

    await detail.assertTaskStatus('verify-organisation-details', 'Not started')
    await detail.assertTaskStatus(
      'confirm-application-completeness',
      'Not started'
    )

    await detail.setTaskStatus('verify-organisation-details', 'InProgress')
    await detail.setTaskStatus('confirm-application-completeness', 'InProgress')

    await detail.assertTaskStatus('verify-organisation-details', 'In progress')
    await detail.assertTaskStatus(
      'confirm-application-completeness',
      'In progress'
    )

    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    // Completing the last submitted task auto-transitions to Duly made —
    // the tasks page immediately shows duly-made tasks after this POST.
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')

    await login.logout()
  })
})

describe('Standard user journey', () => {
  it('find assigned work item, complete tasks, select Duly Made and progress through duly-made stage', async () => {
    await login.login()
    expect(new URL(await browser.getUrl()).pathname).toBe('/work-items')

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

    // Task controls live on the /tasks sub-page
    await detail.gotoTasks()

    await detail.assertTaskStatus('verify-organisation-details', 'Not started')
    await detail.assertTaskStatus(
      'confirm-application-completeness',
      'Not started'
    )

    await detail.setTaskStatus('verify-organisation-details', 'InProgress')
    await detail.setTaskStatus('confirm-application-completeness', 'InProgress')

    await detail.assertTaskStatus('verify-organisation-details', 'In progress')
    await detail.assertTaskStatus(
      'confirm-application-completeness',
      'In progress'
    )

    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    // Completing the last submitted task fires ReAccreditationDulyMadeHook,
    // which auto-transitions to Duly made. The tasks page immediately flips
    // to showing duly-made tasks — no further action needed.
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')

    await detail.gotoDetail()
    await detail.assertState('Duly made')

    // Task controls live on the /tasks sub-page
    await detail.gotoTasks()

    await detail.assertTaskStatus(
      'confirm-registration-fee-paid',
      'Not started'
    )

    await detail.setTaskStatus('confirm-registration-fee-paid', 'InProgress')

    await detail.assertTaskStatus(
      'confirm-registration-fee-paid',
      'In progress'
    )

    await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')

    await detail.assertTaskStatus('confirm-registration-fee-paid', 'Completed')

    await login.logout()
  })
})
