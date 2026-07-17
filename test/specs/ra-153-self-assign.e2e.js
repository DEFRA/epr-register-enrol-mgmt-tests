import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-153 — 403 when self-assigning a work item.
 *
 * Journey:
 *   1. Login as a standard user
 *   2. Create a work item
 *   3. Open the work item and take it (self-assign)
 *   4. Work item assignment should reflect the standard user
 */
describe('RA-153 — self-assign: standard user takes an unassigned work item', () => {
  let workItemId

  before(async () => {
    await login.loginAs('standard')
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

    // Newly created work item is unassigned — "Take this work item" must be visible
    await expect($('[data-testid="self-assign-submit"]')).toBeDisplayed()

    // Take the work item — this returned a 403 before RA-153 was fixed
    await $('[data-testid="self-assign-submit"]').click()

    // After PRG redirect, the detail page should confirm assignment to the
    // caller rather than showing a 403 or an unassigned state
    await expect(
      $('[data-testid="assignment-caller-is-assignee"]')
    ).toBeDisplayed()
    await expect($('[data-testid="assignment-caller-is-assignee"]')).toHaveText(
      expect.stringContaining('This work item is assigned to you.')
    )
  })

  it('shows the standard user as assignee in the work item summary', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.assertAssignedTo('Stub Standard User')
  })
})
