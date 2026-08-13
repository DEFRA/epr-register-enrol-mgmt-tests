import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-238 — E2E: officer-assignment notification outcomes, under the RA-422
 * default.
 *
 * RA-227 made caseworker officer assignment (assign / re-assign / unassign)
 * on a ReAccreditation work item fire an "OfficerAssignment" notification to
 * the nation's regulator mailbox and record the outcome as an audit entry
 * (`notification-sent` when a mailbox is configured, `notification-skipped`
 * otherwise). RA-422 then put all Case Management email functionality behind
 * the `Notify:Enabled` feature flag (default false), and the e2e stack runs
 * with it OFF.
 *
 * The flag gates the single post-action hook that BOTH sends the emails AND
 * writes those notification audit entries, so with it off assignment still
 * works (the officer is assigned / unassigned) but NO OfficerAssignment
 * notification entry is written — neither sent (England) nor skipped
 * (unconfigured nations). This spec proves that new default: the assignment
 * lifecycle survives, the notification rows do not.
 *
 * Nation is still derived by the backend from the site postcode
 * (NationResolver): SW1A -> England (a configured mailbox), EH -> Scotland
 * (unconfigured). With emails disabled that distinction no longer changes the
 * audit log — neither records a notification — but both are kept to prove
 * assignment itself works regardless of nation.
 *
 * Part of epic RA-227.
 */

const OFFICER_ASSIGNMENT_TEMPLATE = 'OfficerAssignment'

describe('RA-238 officer-assignment notifications (disabled by RA-422)', () => {
  describe('England work item — assignment succeeds but does not notify', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      // SW1A postcode -> England (a configured RegulatorMailboxes nation).
      // With Notify off this no longer matters to the audit log, but keeps the
      // England path covered for when the flag is re-enabled.
      workItemId = (
        await workItems.createWorkItem({
          organisationName: 'Officer Assign Notify Ltd',
          siteAddressLine1: '238 Assign Way',
          siteAddressTown: 'London',
          siteAddressPostcode: 'SW1A 1AA',
          material: 'plastic',
          tonnageBand: '0-500'
        })
      ).id
      await workItems.openWorkItem(workItemId)
      await detail.assertUnassigned()
    })

    after(async () => {
      await login.logout()
    })

    it('assigns the officer without recording an OfficerAssignment send', async () => {
      await detail.assignTo('stub-caseworker-2')
      await detail.assertAssignedTo('Stub Caseworker Two')

      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()

      // Scoped by template: with the Notify flag off no OfficerAssignment
      // notification is written at all, so this is 0 (it was 1 pre-RA-422).
      const assignmentSends = await detail.notificationSentEntriesForTemplate(
        OFFICER_ASSIGNMENT_TEMPLATE
      )
      expect(assignmentSends.length).toBe(0)
    })

    it('re-assigning the officer still records no OfficerAssignment send', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assignTo('stub-caseworker-3')
      await detail.assertAssignedTo('Stub Caseworker Three')

      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()

      const assignmentSends = await detail.notificationSentEntriesForTemplate(
        OFFICER_ASSIGNMENT_TEMPLATE
      )
      expect(assignmentSends.length).toBe(0)
    })

    it('unassigning the officer still records no OfficerAssignment send', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.unassign()
      await detail.assertUnassigned()

      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()

      const assignmentSends = await detail.notificationSentEntriesForTemplate(
        OFFICER_ASSIGNMENT_TEMPLATE
      )
      expect(assignmentSends.length).toBe(0)
    })
  })

  describe('Unconfigured nation (Scotland) — assignment succeeds, no notification', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      // An EH (Edinburgh) postcode routes to Nation.Scotland (no configured
      // RegulatorMailboxes address). Pre-RA-422 this produced a
      // notification-skipped entry; with Notify off nothing is written.
      workItemId = (
        await workItems.createWorkItem({
          organisationName: 'Officer Assign Skip Ltd',
          siteAddressLine1: '238 Skip Wynd',
          siteAddressTown: 'Edinburgh',
          siteAddressPostcode: 'EH1 1AA',
          material: 'plastic',
          tonnageBand: '0-500'
        })
      ).id
      await workItems.openWorkItem(workItemId)
      await detail.assertUnassigned()
    })

    after(async () => {
      await login.logout()
    })

    it('still assigns the officer', async () => {
      await detail.assignTo('stub-caseworker-2')
      await detail.assertAssignedTo('Stub Caseworker Two')
    })

    it('records neither a skipped nor a sent OfficerAssignment notification', async () => {
      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()

      // With the Notify flag off the post-action hook never fires, so neither
      // outcome is recorded for the OfficerAssignment template.
      const assignmentSkips = await detail.notificationEntriesForTemplate(
        'notification-skipped',
        OFFICER_ASSIGNMENT_TEMPLATE
      )
      expect(assignmentSkips.length).toBe(0)

      const assignmentSends = await detail.notificationSentEntriesForTemplate(
        OFFICER_ASSIGNMENT_TEMPLATE
      )
      expect(assignmentSends.length).toBe(0)
    })
  })
})
