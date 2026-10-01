import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import {
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'
import {
  beforeClockStartDeadline,
  dulyMadeAnchorDeadline,
  earlierFutureDeadline,
  farFutureDeadline
} from '../support/sla-extend-date.js'

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
 * RA-601 removed CM6's extension-only lower bound, which inverted one case
 * in this file: a new deadline EARLIER than the current one is now accepted,
 * not rejected. The ra-601 spec owns that journey end to end; the inverted
 * case stays here so the removed bound cannot quietly return.
 *
 * RA-611 then put back a DIFFERENT bound — a FLOOR at the later of the
 * duly-made date and 1 January of the accreditation year — which is not the one
 * RA-601 removed and must not be read as a revert of it. (Its first revision
 * floored the deadline at today; the spec was corrected on 29-Sep-2026 and
 * backdating above the floor is legal.) Two consequences here: a one-line
 * rejection guard sits next to the RA-601 case so the two rules are read
 * together, and the RA-601 case can no longer take its old shortcut of
 * submitting a past date to get something "earlier than the current due date".
 * It pins the deadline far out first.
 *
 * That shortcut is gone for a subtler reason than "past dates are invalid",
 * which they are not. This spec's fixture is duly made during the run, so its
 * floor is TODAY and it happens to have no past to reach into — an accident of
 * the fixture, not the rule. The dedicated ra-611 spec owns the real journey on
 * an item duly made sixty days back, the floor boundary, and the proof that a
 * rejected submission changes nothing.
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

    it('rejects a new due date below the duly-made date (RA-611)', async () => {
      // RA-611's narrow regression guard, sitting alongside RA-601's below so
      // the two rules are visible together and cannot be confused for each
      // other. RA-601 removed the extension-only bound; RA-611 adds a FLOOR at
      // the later of the duly-made date and 1 January of the accreditation
      // year. A date a year back therefore fails again — but for a different
      // reason than it did before RA-601, which is why this asserts the TEXT.
      //
      // WHY THE FLOOR IS TODAY FOR THIS ITEM, which is incidental and must not
      // be mistaken for the rule. This spec's fixture is duly made during the
      // run with no `dayOffset`, so its payment date — and therefore its SLA
      // clock, and therefore its floor — is today. Backdating is perfectly
      // legal under RA-611; it is just that THIS item has nothing to backdate
      // into. `dulyMadeAnchorDeadline(0)` says so explicitly rather than
      // reaching for a "today" helper, which would read as though the rule were
      // about today. The dedicated ra-611 spec owns the real journey, on a
      // fixture duly made sixty days back.
      await slaExtend.expectRejectedBelowDulyMade(workItemId, {
        reason: 'Regulator backdating the determination deadline',
        date: beforeClockStartDeadline(),
        dulyMadeOn: dulyMadeAnchorDeadline(0)
      })
    })

    it('accepts a new due date EARLIER than the current due date (RA-601)', async () => {
      // THE OPPOSITE OF WHAT THIS CASE USED TO ASSERT. CM6 shipped an
      // extension-only lower bound and this spec pinned it: a backwards move
      // had to be rejected. RA-601 established that bound was an
      // implementation assumption rather than an AC — CM5/CM6 never asked for
      // it, and RA-572's rename from "Extend" to "Change" made it visibly
      // wrong. The case is kept rather than deleted because a regulator
      // pulling the deadline forwards is now a first-class journey, and the
      // regression worth guarding is the bound coming back.
      //
      // RA-611 ALSO CHANGED THIS CASE, without changing what it asserts. It
      // used to submit a date a year in the PAST, on the reasoning that a past
      // date is always earlier than an unelapsed due date and so the spec never
      // had to read the real "Due on" value. RA-611 puts a floor under this
      // item at its duly-made date, which — because the fixture is duly made
      // during the run — is today, so the shortcut is gone: the only way to
      // submit a date both earlier than the current deadline AND above the floor
      // is to know where the current deadline is. Hence the pin first. Note this
      // is the FIXTURE's limitation, not RA-611's: an item duly made in the past
      // can be backdated, as the ra-611 spec demonstrates.
      //
      // Unlike its pre-RA-601 predecessor this submission SUCCEEDS, so it
      // leaves the input page and applies a change. That is safe here: the
      // cases below it in this block do not depend on the deadline's value,
      // and the happy path re-pins it far out. The dedicated ra-601 spec owns
      // the detail of what the header then shows.
      await slaExtend.changeDeadline(workItemId, {
        reason: 'Pinning the determination deadline before reducing it',
        date: farFutureDeadline()
      })

      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'Regulator advancing the determination deadline',
        date: earlierFutureDeadline()
      })
      await slaExtend.submitForm()
      await slaExtend.waitForDetailUrl(workItemId)
      await detail.assertFlashBanner()
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
