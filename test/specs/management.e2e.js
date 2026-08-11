import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  dulyMake,
  driveToAssessmentInProgress,
  ASSESSMENT_TASKS
} from '../support/re-accreditation-journey.js'

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

    await detail.assertState('Not started')

    // RA-316 deleted the two `submitted` tasks this block used to walk, and
    // the tasks panel for that state with them, so there is nothing to drive
    // there any more. The block's subject is a MULTI-task status walk, so it
    // re-bases onto `assessment-in-progress` — the state that still declares
    // three tasks — rather than onto the single-task `duly-made`.
    await driveToAssessmentInProgress(progressedWorkItemId)

    // Task controls live on the /tasks sub-page
    await detail.gotoTasks()

    for (const task of ASSESSMENT_TASKS) {
      await detail.assertTaskStatus(task, 'Not started')
    }

    for (const task of ASSESSMENT_TASKS) {
      await detail.setTaskStatus(task, 'InProgress')
    }

    for (const task of ASSESSMENT_TASKS) {
      await detail.assertTaskStatus(task, 'In progress')
    }

    for (const task of ASSESSMENT_TASKS) {
      await detail.setTaskStatus(task, 'Completed')
    }

    // Completing every assessment task does NOT transition the item — RA-316
    // removed the auto-transition hooks, and `submit-for-decision` is an
    // explicit action — so the item is still here afterwards.
    await detail.gotoDetail()
    await detail.assertState('Updated')

    await login.logout()
  })
})

describe('Standard user journey', () => {
  it('find assigned work item, duly make it and progress through the duly-made stage', async () => {
    await login.login()
    expect(new URL(await browser.getUrl()).pathname).toBe('/work-items')

    // ── Navigate to work items and filter by "assigned to me" ─────────────────
    // RA-324 phase-2: the Assignment radios now live inside a collapsed
    // <details> section, so a raw click on the radio is not interactable — the
    // page object helper expands the section first.
    await workItems.goto()
    await workItems.setAssignmentMode('mine')
    await workItems.applyFilters()

    await expect(workItems.workItemLink(assignedWorkItemId)).toBeDisplayed()
    await expect(workItems.workItemStateTag(assignedWorkItemId)).toHaveText(
      expect.stringContaining('Not started')
    )

    await workItems.openWorkItem(assignedWorkItemId)
    await detail.assertState('Not started')

    // RA-316: submitted -> duly-made is the "Duly make" CTA plus a payment
    // date. There are no submitted tasks to complete first, and no hook to
    // fire — the transition is the caseworker's explicit act.
    await dulyMake(assignedWorkItemId)
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
