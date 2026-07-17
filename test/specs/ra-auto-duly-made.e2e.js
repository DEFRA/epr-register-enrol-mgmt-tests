import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * Auto duly-made transition and SLA clock start.
 *
 * When all submitted-state tasks are completed, the backend hook
 * (ReAccreditationDulyMadeHook) automatically transitions the work item
 * from submitted → duly-made and starts the SLA clock. No separate
 * "Mark as duly made" action button click is needed.
 *
 * Tests cover:
 *   - The "Mark as duly made" action button is absent from the submitted
 *     state detail page.
 *   - Completing both submitted tasks causes the detail page to show
 *     "Duly made" state without any intermediate action click.
 *   - The SLA clock section appears on the detail page immediately after
 *     the auto-transition (visible to team leaders who have canManageSla).
 *   - The audit log contains both an "Action applied" entry (for the
 *     duly-make auto-transition) and an "SLA clock started" entry.
 *   - The SLA clock info remains visible after the item advances to
 *     "Assessment in progress" via the payment-received action.
 */
describe('Auto duly-made and SLA clock start', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: `Auto Duly Made ${Date.now()}`,
        siteAddressLine1: '1 Auto Street',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AA',
        material: 'plastic',
        tonnageBand: '0-500'
      })
    ).id
    await login.logout()
  })

  describe('submitted state — no duly-make button', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('does not show a "Mark as duly made" action button while in submitted state', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Submitted')
      // The duly-make action button was removed; the transition is now
      // automatic when both submitted tasks are completed.
      await expect($('[data-testid="action-duly-make"]')).not.toBeDisplayed()
    })
  })

  describe('auto-transition on last submitted task completion', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('auto-transitions to Duly made when the last submitted task is completed', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoTasks()
      await detail.setTaskStatus('verify-organisation-details', 'Completed')
      await detail.setTaskStatus(
        'confirm-application-completeness',
        'Completed'
      )
      // ReAccreditationDulyMadeHook fires on last task completion —
      // no action button click required.
      await detail.gotoDetail()
      await detail.assertState('Duly made')
    })
  })

  describe('SLA clock in duly-made state', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('shows SLA clock status section on the detail page in duly-made state', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Duly made')
      // SLA clock section is visible to team leaders (canManageSla).
      await expect($('[data-testid="sla-clock-info"]')).toBeDisplayed()
    })

    it('audit log contains sla-clock-started entry after auto-transition', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      await detail.assertAuditEntry('SLA clock started')
    })

    it('audit log contains action-applied entry for the duly-make auto-transition', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      // The hook records an action-applied audit entry with actionId=duly-make.
      await detail.assertAuditEntry('Action applied')
    })
  })

  describe('SLA clock persists after payment-received', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('transitions to Assessment in progress via payment-received', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoTasks()
      await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
      await detail.gotoDetail()
      await detail.triggerAction('payment-received')
      await detail.assertState('Assessment in progress')
    })
  })

  describe('SLA clock visible in assessment-in-progress', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('SLA clock info is still visible after payment-received resets the clock', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Assessment in progress')
      // The payment-received action (ReAccreditationSlaStampHook) resets
      // the SLA clock — the clock should still be shown.
      await expect($('[data-testid="sla-clock-info"]')).toBeDisplayed()
    })
  })
})
