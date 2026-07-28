import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import queryPage from '../page-objects/query.page.js'

/**
 * RA-295 (AC03 + AC04) — assignment stays reachable through the redesign, and
 * the query page's assignment promise becomes conditional.
 *
 * AC03: the redesign moves assignment into a bordered right-hand panel. The
 * risk it guards against is the panel only being wired up for the state the
 * designer had on screen — a freshly created, unassigned item — leaving a
 * caseworker unable to reassign or release an item once it is held. So each
 * control is asserted in the state where it is meaningful, INCLUDING the
 * "assigned to somebody else" state, which is the one a layout rewrite is
 * most likely to miss.
 *
 * AC04: the "When you send the query, the application will also be assigned to
 * you" content must show when the item is unassigned and must NOT show when it
 * is already assigned. Before RA-295 that inset text rendered
 * unconditionally, so the negative half is the test that actually has teeth —
 * the positive half alone passes against the old markup and could never fail.
 */
describe('RA-295 assignment panel and query assignment notice', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'RA-295 Assignment Panel Ltd',
      siteAddressLine1: '1 Panel Place',
      siteAddressTown: 'Leeds',
      siteAddressPostcode: 'LS1 1AA',
      material: 'plastic',
      tonnageBand: '0-500'
    }))
    await workItems.openWorkItem(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  describe('AC03 — assignment controls in the right-hand panel', () => {
    it('shows the assignment panel on an unassigned item', async () => {
      await detail.assertUnassigned()
      await expect(detail.assignmentPanel()).toBeDisplayed()
    })

    it('offers "Assign to yourself" while the item is unassigned', async () => {
      await expect(detail.assignmentControl('selfAssign')).toBeDisplayed()
    })

    it('offers the assign/reassign control while the item is unassigned', async () => {
      await expect(detail.assignmentControl('reassign')).toBeDisplayed()
    })

    describe('once the item is assigned to another caseworker', () => {
      before(async () => {
        // Assigned to somebody ELSE, not to the signed-in user: this is the
        // state where a caseworker most needs reassign/unassign, and the one a
        // panel wired only for "my own item" would break.
        await detail.assignTo('stub-caseworker-2')
        await detail.assertAssignedTo('Stub Caseworker Two')
      })

      it('still shows the assignment panel', async () => {
        await expect(detail.assignmentPanel()).toBeDisplayed()
      })

      it('offers "Reassign the application"', async () => {
        await expect(detail.assignmentControl('reassign')).toBeDisplayed()
      })

      it('offers "Unassign the application"', async () => {
        await expect(detail.assignmentControl('unassign')).toBeDisplayed()
      })

      it('can actually reassign from the panel', async () => {
        // Presence is not the whole AC — the control has to work from the new
        // panel, so this drives it end to end rather than eyeballing the DOM.
        await detail.assignTo('stub-caseworker-3')
        await detail.assertAssignedTo('Stub Caseworker Three')
        await expect(detail.assignmentPanel()).toBeDisplayed()
      })
    })
  })

  describe('AC04 — the query page assignment notice', () => {
    describe('when the application is already assigned', () => {
      // Continues from the AC03 block above, where the item ended up held by
      // Stub Caseworker Three.
      before(async () => {
        await detail.assertAssignedTo('Stub Caseworker Three')
        await queryPage.gotoFor(workItemId)
      })

      it('does not promise to assign the application to the querying user', async () => {
        // Telling a caseworker that querying "will also assign the application
        // to you" is simply false here — somebody already holds it.
        expect(await queryPage.hasAssignmentNotice()).toBe(false)
      })
    })

    describe('when the application is unassigned', () => {
      before(async () => {
        await workItems.openWorkItem(workItemId)
        await detail.unassign()
        await detail.assertUnassigned()
        await queryPage.gotoFor(workItemId)
      })

      it('tells the user that querying will also assign the application to them', async () => {
        await expect(queryPage.assignmentNotice()).toBeDisplayed()
        await expect(queryPage.assignmentNotice()).toHaveText(
          expect.stringContaining(
            'the application will also be assigned to you'
          )
        )
      })
    })
  })
})
