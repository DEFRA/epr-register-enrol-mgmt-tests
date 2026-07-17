import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * Assign / re-assign / unassign (epr-fsn).
 *
 * RA-153 only covers the self-assign shortcut. The assign-to-anyone
 * picker paths (POST /work-items/{id}/assign and /unassign — available to
 * every caseworker per RA-323) had no coverage. This exercises the full
 * lifecycle:
 *
 *   1. Login
 *   2. Create a work item — it starts Unassigned
 *   3. Assign it to another user via the assignee <select>
 *   4. Re-assign it to a different user via the same select
 *   5. Unassign it via the Unassign form
 *
 * The envelope summary "Assigned to" row is asserted at each step.
 */
describe('Assign / re-assign / unassign via the assign-to-anyone picker', () => {
  let workItemId

  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  it('creates an unassigned work item', async () => {
    await workItems.goto()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'Assign Picker Test Ltd',
      siteAddressLine1: '1 Assign Street',
      siteAddressTown: 'London',
      siteAddressPostcode: 'SW1A 1AA',
      material: 'plastic',
      tonnageBand: '0-500'
    }))

    await workItems.openWorkItem(workItemId)

    // A freshly created item is unassigned; the assign picker and the
    // self-assign shortcut are both shown, but there's no unassign
    // control yet since nobody holds the item.
    await detail.assertUnassigned()
    await expect($('[data-testid="assign-select"]')).toBeDisplayed()
    await expect($('[data-testid="unassign-submit"]')).not.toBeExisting()
  })

  it('assigns the item to another user via the select', async () => {
    await detail.assignTo('stub-caseworker-2')
    await detail.assertAssignedTo('Stub Caseworker Two')

    // Once assigned, the unassign control appears alongside the picker.
    await expect($('[data-testid="unassign-submit"]')).toBeDisplayed()
  })

  it('re-assigns the item to a different user via the select', async () => {
    await detail.assignTo('stub-caseworker-3')
    await detail.assertAssignedTo('Stub Caseworker Three')
  })

  it('unassigns the item via the unassign form', async () => {
    await detail.unassign()
    await detail.assertUnassigned()

    // Back to the unassigned state: picker remains, unassign control gone.
    await expect($('[data-testid="assign-select"]')).toBeDisplayed()
    await expect($('[data-testid="unassign-submit"]')).not.toBeExisting()
  })
})
