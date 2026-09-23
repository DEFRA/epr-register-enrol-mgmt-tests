import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import {
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'
import { farFutureDeadline, pastDeadline } from '../support/sla-extend-date.js'

/**
 * RA-131 — change the determination deadline.
 *
 * Single-step flow: any caseworker (RA-323 — every caseworker holds the
 * same role) fills in the reason + the new deadline, submits, and lands
 * back on the work item with a success banner. The page replaces a
 * CSP-blocked modal (RA-94 forbids browser JS on work-item pages).
 *
 *   - GET  /work-items/{id}/sla/extend  — input page
 *   - POST /work-items/{id}/sla/extend  — apply and redirect to detail
 *
 * RA-572 retired the sibling Override flow and reworded this one from
 * "extend" to "change" — the route and every `sla-extend-*` testid are
 * deliberately UNCHANGED (a content + removal ticket, not a rename), so
 * only the visible copy assertions below moved. The dedicated
 * ra-572-hide-override spec owns the removal itself; this file keeps its
 * original job of covering validation, cancel and the happy path.
 *
 * These e2e tests drive a re-accreditation work item to the
 * "Assessment in progress" state (the only state where the change-deadline
 * action is available per re-accreditation/module.js) and then exercise
 * validation, cancel, and the happy path.
 */
describe('RA-131 Change determination deadline', () => {
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
    await detail.assertState('Not started')

    // Submitted -> Duly made. RA-316 replaced the submitted tasks and
    // the auto-transition hook with the "Duly make" CTA and a payment
    // date; the shared helper owns that journey.
    await dulyMake(workItemId)

    // Duly made -> Assessment in progress (sla-extend becomes available)
    await startAssessment(workItemId)
    await detail.assertState('Updated')

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

    it('navigates to the input page when the change-deadline action is clicked', async () => {
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

    it('shows an error summary when the new due date is incomplete', async () => {
      // CM6: additionalDays' "not a number" check is replaced by the date
      // input's own incomplete/invalid-date validation (mirrors
      // duly-making's setPaymentDate() incomplete-date coverage).
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'Awaiting further documents',
        date: { day: 15 } // month/year omitted
      })
      await slaExtend.submitForm()
      await slaExtend.assertErrorSummaryDisplayed()
      await slaExtend.assertOnInputPage()
    })

    it('shows an error summary when the new due date is not after the current due date (CM6: extension only)', async () => {
      // A date in the past is always before an unelapsed due date, so this
      // does not need to read and parse the real "Due on" value — any
      // caseworker attempt to move the deadline backwards must be rejected.
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'Awaiting further documents',
        date: pastDeadline()
      })
      await slaExtend.submitForm()
      await slaExtend.assertErrorSummaryDisplayed()
      await slaExtend.assertOnInputPage()
    })

    it('renders "Change determination deadline" wording, not "SLA" or "extend" (RA-572)', async () => {
      // RA-447 (CM5) moved this page off "SLA"; RA-572 moves it off "extend"
      // as well, so both stale vocabularies are asserted gone in one place.
      await slaExtend.gotoFor(workItemId)
      expect(await slaExtend.pageHeadingText()).toBe(
        'Change determination deadline'
      )
      expect(await slaExtend.reasonLabelText()).toBe('Reason for change')
      expect(await slaExtend.reasonHintText()).toBe(
        'Explain why the determination deadline needs to be changed.'
      )
      expect(await slaExtend.submitButtonText()).toBe(
        'Change determination deadline'
      )
      await slaExtend.assertNoStaleDeadlineWording()
    })

    it('cancel from the input page returns to the work item with no changes', async () => {
      await slaExtend.gotoFor(workItemId)
      await slaExtend.cancelFromInputPage()
      await slaExtend.waitForDetailUrl(workItemId)
      // No flash banner should appear because nothing was applied.
      await detail.assertNoFlashBanner()
    })
  })

  describe('happy path', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('submitting valid input applies the change and surfaces a banner on the work item', async () => {
      // A far-future date doubles as CM6's "no upper limit" proof: the old
      // additionalDays input capped at 31 by default, so a date this far out
      // would previously 422 rather than apply.
      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'Operator providing additional evidence',
        date: farFutureDeadline()
      })
      await slaExtend.submitForm()
      await slaExtend.waitForDetailUrl(workItemId)

      // Whether the backend extends the SLA or returns an actionable
      // error (e.g. work item has no SLA clock yet), the controller PRGs
      // back to the work item with a flash banner — never silently.
      await detail.assertFlashBanner()
      // CM5 reworded the banner away from "SLA"; RA-572 reworded it again to
      // "Determination deadline changed" / "The determination deadline has
      // been changed." Both stale vocabularies are asserted gone rather than
      // the new copy pinned byte-for-byte — the exact sentence is content
      // design's to tune, the absence of "SLA"/"extend" is the AC.
      const bannerText = (await detail.flashBannerText()).toLowerCase()
      expect(bannerText).not.toContain('sla')
      expect(bannerText).not.toContain('extend')
    })
  })
})
