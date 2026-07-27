import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaOverride from '../page-objects/sla-override.page.js'

/**
 * RA-131 — SLA state tag on the work item detail page.
 *
 * The detail page shows an SLA status tag ("On track", "At risk",
 * "Breached") to any caseworker once a clock is running (RA-323 — every
 * caseworker holds the same role). This spec verifies each of the three
 * states by using the SLA override flow to manipulate the clock directly:
 *
 *   - OnTrack:  target=90 days, started now  → remaining=90 d > 14 d
 *   - AtRisk:   target=15 days, started 2 d ago → remaining=13 d ≤ 14 d
 *   - Breached: target=1 day,  started 2 d ago → remaining=-1 d ≤ 0
 *
 * The tag is only visible once the backend exposes a slaState value.
 */
describe('RA-131 SLA state tag on the detail page', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'SLA Tag Test Ltd',
        siteAddressLine1: '1 Tag Way',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AG',
        material: 'plastic',
        tonnageBand: '0-500'
      })
    ).id

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Not started')

    // Submitted -> Duly made (auto-transition on last submitted task completion)
    await detail.gotoTasks()
    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')
    await detail.gotoDetail()
    await detail.assertState('Duly made')

    // Duly made -> Assessment in progress (payment-received stamps the SLA clock)
    await detail.gotoTasks()
    await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('payment-received')
    await detail.assertState('Updated')
  })

  after(async () => {
    await login.logout()
  })

  it('shows "On track" when more than 14 days remain on the SLA', async () => {
    const startedAt = new Date().toISOString()
    await slaOverride.gotoFor(workItemId)
    await slaOverride.fillForm({
      reason: 'Reset to on-track for tag test',
      newTargetDays: 90,
      newStartedAt: startedAt
    })
    await slaOverride.submitForm()
    await slaOverride.waitForDetailUrl(workItemId)

    await expect($('[data-testid="sla-clock-info"]')).toHaveText(
      expect.stringContaining('On track')
    )
  })

  it('shows "At risk" when fewer than 14 days remain on the SLA', async () => {
    // target=15 days, started 2 days ago → remaining = 13 days ≤ 14 → AtRisk
    const twoDaysAgo = new Date(
      Date.now() - 2 * 24 * 60 * 60 * 1000
    ).toISOString()
    await slaOverride.gotoFor(workItemId)
    await slaOverride.fillForm({
      reason: 'Drive into at-risk zone for tag test',
      newTargetDays: 15,
      newStartedAt: twoDaysAgo
    })
    await slaOverride.submitForm()
    await slaOverride.waitForDetailUrl(workItemId)

    await expect($('[data-testid="sla-clock-info"]')).toHaveText(
      expect.stringContaining('At risk')
    )
  })

  it('shows "Breached" when the SLA deadline has passed', async () => {
    // target=1 day, started 2 days ago → remaining = -1 day ≤ 0 → Breached
    const twoDaysAgo = new Date(
      Date.now() - 2 * 24 * 60 * 60 * 1000
    ).toISOString()
    await slaOverride.gotoFor(workItemId)
    await slaOverride.fillForm({
      reason: 'Drive past deadline for tag test',
      newTargetDays: 1,
      newStartedAt: twoDaysAgo
    })
    await slaOverride.submitForm()
    await slaOverride.waitForDetailUrl(workItemId)

    await expect($('[data-testid="sla-clock-info"]')).toHaveText(
      expect.stringContaining('Breached')
    )
  })
})
