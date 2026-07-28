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
      siteAddressPostcode: 'SW1A 1AB',
      material: 'plastic',
      tonnageBand: '0-500'
    }))

    await workItems.openWorkItem(workItemId)

    // RA-295 (AC03) changed the shape of this panel. The assignee picker and
    // the unassign button moved onto GET interstitials, so the detail page now
    // carries LINKS; and reassign/unassign are unconditional rather than
    // appearing only once somebody holds the item. The lifecycle below is
    // unchanged — it is only how each step is reached that moved.
    await detail.assertUnassigned()
    for (const control of ['selfAssign', 'reassign', 'unassign']) {
      expect(await detail.hasAssignmentControl(control)).toBe(true)
    }
  })

  it('assigns the item to another user via the assign interstitial', async () => {
    await detail.assignTo('stub-caseworker-2')
    await detail.assertAssignedTo('Stub Caseworker Two')
  })

  it('re-assigns the item to a different user via the assign interstitial', async () => {
    await detail.assignTo('stub-caseworker-3')
    await detail.assertAssignedTo('Stub Caseworker Three')
  })

  it('unassigns the item via the unassign interstitial', async () => {
    await detail.unassign()
    await detail.assertUnassigned()
  })

  it('offers the unassign link even when nobody holds the item', async () => {
    // The link is unconditional now, so the interstitial has to cope with an
    // already-unassigned item rather than 500 or offer a no-op submit. That
    // graceful path is easy to miss precisely because the link used to be
    // hidden in this state.
    expect(await detail.hasAssignmentControl('unassign')).toBe(true)
    await detail.assignmentControl('unassign').click()
    await expect(
      $('[data-testid="unassign-already-unassigned"]')
    ).toBeDisplayed()
    await expect($('[data-testid="unassign-submit"]')).not.toBeExisting()
    await $('[data-testid="unassign-cancel"]').click()
    await detail.waitForDetailUrl()
  })
})
