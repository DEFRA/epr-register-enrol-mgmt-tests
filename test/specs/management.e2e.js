import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  dulyMake,
  startAssessment
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

    // RA-410 deleted Tasks. This block used to walk three assessment tasks
    // through Not started -> In progress -> Completed; its subject was the
    // task status machinery, which no longer exists. It re-bases onto the
    // thing that REPLACED that machinery — the two green CTAs that carry an
    // item from `submitted` to `assessment-in-progress` — so the block still
    // earns its place as the broad "a caseworker can move a case along"
    // regression rather than being deleted with the feature.
    await dulyMake(progressedWorkItemId)
    await detail.assertState('Duly made')

    await startAssessment(progressedWorkItemId)
    // `assessment-in-progress` and `updated` share the display name "Updated"
    // (RA-324), so the raw id is the only assertion that can tell them apart.
    await detail.assertStateId('assessment-in-progress')
    await detail.assertState('Updated')

    // AC02: no task panel, link or progress line survives on the detail page
    // in the state that used to carry the most tasks of any.
    expect(await detail.hasTasksPanel()).toBe(false)
    expect(await detail.hasTasksLink()).toBe(false)
    expect(await detail.hasTaskProgress()).toBe(false)

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

    // RA-410: `duly-made` used to declare `confirm-registration-fee-paid`,
    // and this block walked it through its three statuses. The task is gone
    // and the transition it gated is ungated, so the step a caseworker
    // actually takes from here is the green "Assign to yourself and start".
    //
    // NOTE this item was assigned to Stub Caseworker One above, so it has to
    // be released before the self-assign CTA is offered at all — which is
    // itself worth exercising, since it is the ordinary case of picking up
    // somebody else's unstarted work.
    await detail.unassign()
    await detail.assertUnassigned()

    await startAssessment(assignedWorkItemId)
    await detail.assertStateId('assessment-in-progress')

    await login.logout()
  })
})
