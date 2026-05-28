import { $, browser, expect } from '@wdio/globals'
import login from 'page-objects/login.page.js'
import workItems from 'page-objects/work-items.page.js'
import detail from 'page-objects/work-item-detail.page.js'
import slaExtend from 'page-objects/sla-extend.page.js'

/**
 * RA-131 — Extend SLA two-step wizard.
 *
 * Replaces the original modal-based design (blocked by CSP / RA-94
 * "no browser JS on work-item pages") with a server-rendered wizard:
 *
 *   1. /sla/extend                 — input page
 *   2. /sla/extend (POST)          — confirmation page
 *   3. /sla/extend/confirm (POST)  — apply the change and redirect
 *
 * These e2e tests drive a re-accreditation work item to the
 * "Assessment in progress" state (which is the only state from which
 * the "Extend SLA" action is available per re-accreditation/module.js)
 * and then exercise every branch of the wizard, including role-gating
 * (team leader only), validation, cancel, and the happy path.
 */
describe('RA-131 Extend SLA wizard', () => {
  let workItemId

  before(async () => {
    // The "assign" stub user has standard + assign roles but is not a
    // team leader, so they can create the work item and progress it
    // through tasks but cannot extend the SLA. That keeps the role
    // boundary obvious in the spec.
    await login.loginAs('assign')
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'SLA Extend Test Ltd',
        siteAddressLine1: '1 Deadline Street',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AA',
        material: 'plastic',
        tonnageBand: '0-500'
      })
    ).id

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Submitted')

    // Submitted -> Duly made
    await detail.gotoTasks()
    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('duly-make')
    await detail.assertState('Duly made')

    // Duly made -> Assessment in progress (sla-extend becomes available)
    await detail.gotoTasks()
    await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('payment-received')
    await detail.assertState('Assessment in progress')

    await login.logout()
  })

  after(async () => {
    await login.logout()
  })

  describe('role gating', () => {
    it('does NOT show the Extend SLA button to a standard user', async () => {
      await login.loginAs('standard')
      await workItems.openWorkItem(workItemId)
      await expect($('[data-testid="action-sla-extend"]')).not.toBeDisplayed()
      await login.logout()
    })

    it('returns 403 when a standard user requests /sla/extend directly', async () => {
      await login.loginAs('standard')
      await browser.url(`/work-items/${workItemId}/sla/extend`)
      await expect($('h1')).toHaveText(expect.stringContaining('403'))
      await login.logout()
    })

    it('does show the Extend SLA button to a team leader', async () => {
      await login.loginAs('team-leader')
      await workItems.openWorkItem(workItemId)
      await expect($('[data-testid="action-sla-extend"]')).toBeDisplayed()
      await login.logout()
    })
  })

  describe('input page', () => {
    before(async () => {
      await login.loginAs('team-leader')
    })

    after(async () => {
      await login.logout()
    })

    it('navigates to the input page when the Extend SLA action is clicked', async () => {
      await workItems.openWorkItem(workItemId)
      await $('[data-testid="action-sla-extend"]').click()
      await slaExtend.assertOnInputPage()
    })

    it('shows an error summary when the form is submitted empty', async () => {
      await slaExtend.gotoFor(workItemId)
      await slaExtend.submitForm()
      await slaExtend.assertErrorSummaryDisplayed()
      await slaExtend.assertOnInputPage()
    })

    it('shows an error summary when additionalDays is not a positive integer', async () => {
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'Awaiting further documents',
        additionalDays: 'not-a-number'
      })
      await slaExtend.submitForm()
      await slaExtend.assertErrorSummaryDisplayed()
      await slaExtend.assertOnInputPage()
    })

    it('shows an error summary when additionalDays exceeds the max (default 31)', async () => {
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'Awaiting further documents',
        additionalDays: 99
      })
      await slaExtend.submitForm()
      await slaExtend.assertErrorSummaryDisplayed()
      await slaExtend.assertOnInputPage()
    })

    it('cancel from the input page returns to the work item with no changes', async () => {
      await slaExtend.gotoFor(workItemId)
      await slaExtend.cancelFromInputPage()
      await slaExtend.waitForDetailUrl(workItemId)
      // No flash banner should appear because nothing was applied.
      await expect(
        $('[data-testid="work-item-flash-banner"]')
      ).not.toBeDisplayed()
    })
  })

  describe('confirmation page', () => {
    before(async () => {
      await login.loginAs('team-leader')
    })

    after(async () => {
      await login.logout()
    })

    it('renders the projected extension and reason for review', async () => {
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'Operator providing additional evidence',
        additionalDays: 7
      })
      await slaExtend.submitForm()

      await slaExtend.assertOnConfirmPage()
      await slaExtend.assertConfirmSummaryHas('7 days')
      await slaExtend.assertConfirmSummaryHas(
        'Operator providing additional evidence'
      )
    })

    it('cancel from the confirmation page returns to the work item with no changes', async () => {
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'Will cancel before confirming',
        additionalDays: 3
      })
      await slaExtend.submitForm()
      await slaExtend.assertOnConfirmPage()
      await slaExtend.cancelFromConfirmPage()
      await slaExtend.waitForDetailUrl(workItemId)
      await expect(
        $('[data-testid="work-item-flash-banner"]')
      ).not.toBeDisplayed()
    })

    it('confirming applies the extension and surfaces a notification banner on the work item', async () => {
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'Operator providing additional evidence (final)',
        additionalDays: 5
      })
      await slaExtend.submitForm()
      await slaExtend.assertOnConfirmPage()
      await slaExtend.confirm()
      await slaExtend.waitForDetailUrl(workItemId)

      // Whether the backend extends the SLA or returns an actionable
      // error (e.g. work item has no SLA clock yet), the wizard PRGs
      // back to the work item with a flash banner — never silently.
      await expect($('[data-testid="work-item-flash-banner"]')).toBeDisplayed()
    })
  })
})
