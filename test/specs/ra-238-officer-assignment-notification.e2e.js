import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-238 — E2E: officer-assignment notification outcomes.
 *
 * Counterpart to the management-be / management-fe RA-227 work delivered on
 * the matching `feature/RA-227` branches. Part of epic RA-227.
 *
 * When an assign-role user assigns, re-assigns or unassigns an officer on a
 * ReAccreditation work item, management-be fires a notification to the
 * regulator shared mailbox for the work item's nation (the "OfficerAssignment"
 * Notify template) and records the outcome as an audit entry — mirroring the
 * `SendAndRecordAsync` shape already used for the lifecycle notifications
 * (RA-123 / RA-234):
 *
 *   - SENT     → `notification-sent`    entry carrying the recipient (the
 *                nation's RegulatorMailboxes address), the notification type
 *                (templateKey = "OfficerAssignment") and the reference (the
 *                work item id).
 *   - SKIPPED  → `notification-skipped` entry carrying reason
 *                "missing-regulator-mailbox" for a nation with no configured
 *                mailbox.
 *
 * England is the only nation this stack configures a mailbox for (see
 * docker/config/management-be.env), so an England work item exercises the SENT
 * path and a Scotland work item (unconfigured) exercises the SKIPPED path.
 * Nation is derived by the backend from the site postcode (NationResolver): an
 * SW1A postcode routes to England, an EH postcode routes to Scotland.
 *
 * Every assertion here is scoped to the OfficerAssignment template rather than
 * to the `notification-sent` / `notification-skipped` action alone. Submitting a
 * work item already records notifications under both actions — the operator
 * SubmissionConfirmation and the RA-240 RegulatorSubmission — so an
 * action-scoped assertion would be satisfied by the submit entries and could
 * never fail.
 *
 * The assignment audit entries render through the same audit-log detail-row
 * projection that RA-234 introduced, so the RA-235 page-object helpers
 * (`notificationEntriesForTemplate` /
 * `assertNotificationDetailRowForTemplate`) drive the assertions here without
 * new selectors.
 *
 * NOTE ON LOCAL EXECUTION: the officer-assignment send lives on the
 * management-be `feature/RA-227` branch. This spec runs against the real
 * backend in the fe/be PR pipelines, which resolve the mgmt-tests spec branch
 * AND the matching management-be branch by the PR head_ref — hence this branch
 * is named `feature/RA-227`.
 */

// Must match Notify__RegulatorMailboxes__England in
// docker/config/management-be.env. Deliberately NOT the live Environment
// Agency address: appsettings.Development.json blanks every nation so no
// environment defaults to a real regulator inbox, and the stack opts back in
// with this unroutable one.
const ENGLAND_REGULATOR_MAILBOX = 'regulator-england@example.test'
const OFFICER_ASSIGNMENT_TEMPLATE = 'OfficerAssignment'

describe('RA-238 officer-assignment notification outcomes', () => {
  describe('England work item — notification-sent to the regulator mailbox', () => {
    let workItemId

    before(async () => {
      await login.loginAs('assign')
      await workItems.goto()
      // SW1A postcode → England, the only configured RegulatorMailboxes
      // nation, so the assignment send resolves a recipient and succeeds.
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

    it('records exactly one OfficerAssignment send when an officer is assigned', async () => {
      await detail.assignTo('stub-standard-1')
      await detail.assertAssignedTo('Stub Standard User')

      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()

      // Counted by template, not by action: submit already recorded two
      // notification-sent entries (the operator SubmissionConfirmation and the
      // RA-240 RegulatorSubmission), so counting all sends could never fail.
      // An exact count also pins that assign sends once, not repeatedly.
      const assignmentSends = await detail.notificationSentEntriesForTemplate(
        OFFICER_ASSIGNMENT_TEMPLATE
      )
      expect(assignmentSends.length).toBe(1)
    })

    it('addresses the assignment notification to the England regulator mailbox', async () => {
      // Scoped to the OfficerAssignment entry: the RA-240 RegulatorSubmission
      // fired on submit is addressed to this same mailbox, so an unscoped
      // assertion would pass on that entry alone.
      await detail.assertNotificationDetailRowForTemplate(
        'notification-sent',
        OFFICER_ASSIGNMENT_TEMPLATE,
        'Recipient',
        ENGLAND_REGULATOR_MAILBOX
      )
    })

    it('routes the assignment notification via the England nation', async () => {
      await detail.assertNotificationDetailRowForTemplate(
        'notification-sent',
        OFFICER_ASSIGNMENT_TEMPLATE,
        'Nation',
        'England'
      )
    })

    it('stamps the work item id as the notification reference', async () => {
      await detail.assertNotificationDetailRowForTemplate(
        'notification-sent',
        OFFICER_ASSIGNMENT_TEMPLATE,
        'Reference',
        workItemId
      )
    })

    it('records a second OfficerAssignment send when the officer is re-assigned', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assignTo('stub-decision-maker-1')
      await detail.assertAssignedTo('Stub Decision Maker')

      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()

      const assignmentSends = await detail.notificationSentEntriesForTemplate(
        OFFICER_ASSIGNMENT_TEMPLATE
      )
      expect(assignmentSends.length).toBe(2)
      await detail.assertNotificationDetailRowForTemplate(
        'notification-sent',
        OFFICER_ASSIGNMENT_TEMPLATE,
        'Recipient',
        ENGLAND_REGULATOR_MAILBOX
      )
    })

    it('records a third OfficerAssignment send when the officer is unassigned', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.unassign()
      await detail.assertUnassigned()

      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()

      const assignmentSends = await detail.notificationSentEntriesForTemplate(
        OFFICER_ASSIGNMENT_TEMPLATE
      )
      expect(assignmentSends.length).toBe(3)
      await detail.assertNotificationDetailRowForTemplate(
        'notification-sent',
        OFFICER_ASSIGNMENT_TEMPLATE,
        'Recipient',
        ENGLAND_REGULATOR_MAILBOX
      )
    })
  })

  describe('Unconfigured nation (Scotland) — notification-skipped', () => {
    let workItemId

    before(async () => {
      await login.loginAs('assign')
      await workItems.goto()
      // An EH (Edinburgh) postcode routes to Nation.Scotland via the backend
      // NationResolver. Scotland has no configured RegulatorMailboxes address,
      // so the assignment succeeds but the send is skipped.
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
      await detail.assignTo('stub-standard-1')
      await detail.assertAssignedTo('Stub Standard User')
    })

    it('records a notification-skipped entry rather than notification-sent', async () => {
      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()

      // Scoped by template throughout: submit on this Scotland item already
      // recorded a notification-skipped for the RA-240 RegulatorSubmission,
      // also with reason missing-regulator-mailbox, so counting skips by action
      // alone would pass whether or not assignment notified at all.
      const assignmentSkips = await detail.notificationEntriesForTemplate(
        'notification-skipped',
        OFFICER_ASSIGNMENT_TEMPLATE
      )
      expect(assignmentSkips.length).toBe(1)

      // And no OfficerAssignment send happened for the unconfigured nation.
      const regulatorSends = await detail.notificationSentEntriesForTemplate(
        OFFICER_ASSIGNMENT_TEMPLATE
      )
      expect(regulatorSends.length).toBe(0)
    })

    it('gives the reason "missing-regulator-mailbox" on the skipped entry', async () => {
      await detail.assertNotificationDetailRowForTemplate(
        'notification-skipped',
        OFFICER_ASSIGNMENT_TEMPLATE,
        'Reason',
        'missing-regulator-mailbox'
      )
    })

    it('records the nation that had no configured mailbox', async () => {
      await detail.assertNotificationDetailRowForTemplate(
        'notification-skipped',
        OFFICER_ASSIGNMENT_TEMPLATE,
        'Nation',
        'Scotland'
      )
    })

    it('records the OfficerAssignment notification type on the skipped entry', async () => {
      await detail.assertNotificationDetailRow(
        'notification-skipped',
        'Notification type',
        OFFICER_ASSIGNMENT_TEMPLATE
      )
    })
  })
})
