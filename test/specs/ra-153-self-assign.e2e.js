import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-153 — self-assign quick action.
 *
 * RA-323: every caseworker holds the same role, so the self-assign
 * shortcut is offered alongside the assign-to-anyone picker (not instead
 * of it) on any unassigned work item.
 *
 * Journey:
 *   1. Login
 *   2. Create a work item
 *   3. Open the work item and take it (self-assign)
 *   4. Work item assignment should reflect the caller
 */
describe('RA-153 — self-assign: a caseworker takes an unassigned work item', () => {
  let workItemId

  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  it('creates a work item and self-assigns it without a 403', async () => {
    await workItems.goto()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'Self Assign Test Ltd',
      siteAddressLine1: '1 Take It Street',
      siteAddressTown: 'London',
      siteAddressPostcode: 'SW1A 1AH',
      material: 'plastic',
      tonnageBand: '0-500'
    }))

    await workItems.openWorkItem(workItemId)

    // Newly created work item is unassigned — "Assign to yourself" is shown
    // alongside the reassign affordance. RA-295 moved the assignee PICKER off
    // this page onto a GET interstitial, so what sits beside the self-assign
    // button here is now the "Reassign the application" link, not a <select>.
    expect(await detail.hasAssignmentControl('selfAssign')).toBe(true)
    expect(await detail.hasAssignmentControl('reassign')).toBe(true)

    // Take the work item — this returned a 403 before RA-153 was fixed
    await $('[data-testid="self-assign-submit"]').click()

    // After PRG redirect, the detail page should confirm assignment to the
    // caller rather than showing a 403 or an unassigned state
    await detail.assertAssignedTo('Stub Caseworker One')
  })

  it('shows the caseworker as assignee in the work item summary', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.assertAssignedTo('Stub Caseworker One')
  })
})
