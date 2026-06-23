import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * Assign / re-assign / unassign by an assign-role user (epr-fsn).
 *
 * RA-153 only covers self-assign by a standard user. The assign-role
 * picker paths (POST /work-items/{id}/assign and /unassign, gated by
 * requireAssign) had no coverage. This exercises the full lifecycle:
 *
 *   1. Login as the assign-role user
 *   2. Create a work item — it starts Unassigned
 *   3. Assign it to another user via the assignee <select>
 *   4. Re-assign it to a different user via the same select
 *   5. Unassign it via the Unassign form
 *
 * The envelope summary "Assigned to" row is asserted at each step.
 */
describe('Assign / re-assign / unassign by an assign-role user', () => {
  let workItemId

  before(async () => {
    await login.loginAs('assign')
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

    // A freshly created item is unassigned and the assign picker is shown
    // to the assign-role user. No unassign control yet.
    await detail.assertUnassigned()
    await expect($('[data-testid="assign-select"]')).toBeDisplayed()
    await expect($('[data-testid="unassign-submit"]')).not.toBeExisting()
  })

  it('assigns the item to another user via the select', async () => {
    await detail.assignTo('stub-standard-1')
    await detail.assertAssignedTo('Stub Standard User')

    // Once assigned, the unassign control appears alongside the picker.
    await expect($('[data-testid="unassign-submit"]')).toBeDisplayed()
  })

  it('re-assigns the item to a different user via the select', async () => {
    await detail.assignTo('stub-decision-maker-1')
    await detail.assertAssignedTo('Stub Decision Maker')
  })

  it('unassigns the item via the unassign form', async () => {
    await detail.unassign()
    await detail.assertUnassigned()

    // Back to the unassigned state: picker remains, unassign control gone.
    await expect($('[data-testid="assign-select"]')).toBeDisplayed()
    await expect($('[data-testid="unassign-submit"]')).not.toBeExisting()
  })
})
