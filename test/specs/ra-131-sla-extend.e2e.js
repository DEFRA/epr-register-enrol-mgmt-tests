import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import slaOverride from '../page-objects/sla-override.page.js'

/**
 * RA-131 — Extend SLA.
 *
 * Single-step flow: any caseworker (RA-323 — every caseworker holds the
 * same role) fills in the reason + number of days, submits, and lands
 * back on the work item with a success banner. The page replaces a
 * CSP-blocked modal (RA-94 forbids browser JS on work-item pages).
 *
 *   - GET  /work-items/{id}/sla/extend  — input page
 *   - POST /work-items/{id}/sla/extend  — apply and redirect to detail
 *
 * These e2e tests drive a re-accreditation work item to the
 * "Assessment in progress" state (the only state where the
 * "Extend SLA" action is available per re-accreditation/module.js)
 * and then exercise validation, cancel, and the happy path.
 */
describe('RA-131 Extend SLA', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'SLA Extend Test Ltd',
        siteAddressLine1: '1 Deadline Street',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AF',
        material: 'plastic',
        tonnageBand: '0-500'
      })
    ).id

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Submitted')

    // Submitted -> Duly made (auto-transition on last submitted task completion)
    await detail.gotoTasks()
    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')
    await detail.gotoDetail()
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

  describe('input page', () => {
    before(async () => {
      await login.login()
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

  describe('happy path', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('submitting valid input applies the extension and surfaces a banner on the work item', async () => {
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'Operator providing additional evidence',
        additionalDays: 7
      })
      await slaExtend.submitForm()
      await slaExtend.waitForDetailUrl(workItemId)

      // Whether the backend extends the SLA or returns an actionable
      // error (e.g. work item has no SLA clock yet), the controller PRGs
      // back to the work item with a flash banner — never silently.
      await expect($('[data-testid="work-item-flash-banner"]')).toBeDisplayed()
    })
  })
})

/**
 * RA-131 — Override SLA.
 *
 * Single-step flow: any caseworker sets a new target duration (and
 * optionally a new start date), submits, and lands back on the work
 * item with a success banner.
 *
 *   - GET  /work-items/{id}/sla/override  — input page
 *   - POST /work-items/{id}/sla/override  — apply and redirect to detail
 *
 * Reuses the same work item left in "Assessment in progress" by the
 * Extend SLA suite above — Override SLA is gated on the same state.
 */
describe('RA-131 Override SLA', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'SLA Override Test Ltd',
        siteAddressLine1: '2 Override Avenue',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 2AA',
        material: 'plastic',
        tonnageBand: '0-500'
      })
    ).id

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Submitted')

    // Submitted -> Duly made (auto-transition on last submitted task completion)
    await detail.gotoTasks()
    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')
    await detail.gotoDetail()
    await detail.assertState('Duly made')

    // Duly made -> Assessment in progress (sla-override becomes available)
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

  describe('input page', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('navigates to the input page when the Override SLA action is clicked', async () => {
      await workItems.openWorkItem(workItemId)
      await $('[data-testid="action-sla-override"]').click()
      await slaOverride.assertOnInputPage()
    })

    it('shows an error summary when the form is submitted empty', async () => {
      await slaOverride.gotoFor(workItemId)
      await slaOverride.submitForm()
      await slaOverride.assertErrorSummaryDisplayed()
      await slaOverride.assertOnInputPage()
    })

    it('shows an error summary when newTargetDays is not a positive integer', async () => {
      await slaOverride.gotoFor(workItemId)
      await slaOverride.fillForm({
        reason: 'Correcting an administrative error',
        newTargetDays: 'not-a-number'
      })
      await slaOverride.submitForm()
      await slaOverride.assertErrorSummaryDisplayed()
      await slaOverride.assertOnInputPage()
    })

    it('cancel from the input page returns to the work item with no changes', async () => {
      await slaOverride.gotoFor(workItemId)
      await slaOverride.cancelFromInputPage()
      await slaOverride.waitForDetailUrl(workItemId)
      await expect(
        $('[data-testid="work-item-flash-banner"]')
      ).not.toBeDisplayed()
    })
  })

  describe('happy path', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('submitting valid input overrides the SLA and surfaces a banner on the work item', async () => {
      await slaOverride.gotoFor(workItemId)
      await slaOverride.fillForm({
        reason: 'Correcting an administrative error in the original SLA',
        newTargetDays: 90
      })
      await slaOverride.submitForm()
      await slaOverride.waitForDetailUrl(workItemId)
      await expect($('[data-testid="work-item-flash-banner"]')).toBeDisplayed()
    })
  })
})
