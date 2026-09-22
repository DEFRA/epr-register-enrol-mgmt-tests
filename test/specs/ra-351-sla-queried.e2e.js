import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import {
  createReAccreditation,
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'
import { raiseQuery } from '../support/query-resubmission.js'
import { uniquePostcode } from '../support/unique-postcode.js'
import { farFutureDeadline } from '../support/sla-extend-date.js'

/**
 * RA-351 — the determination deadline can be changed in the `queried` state.
 *
 * The bug: "On queried state, there is no option to Extend SLA or Override
 * SLA." The due-date links live in the work-item detail page's ASSIGNMENT
 * panel, gated on `canChangeDueDate`. Before RA-351 that predicate was false
 * for `queried`, so a caseworker who had queried an application could no
 * longer move its SLA clock — even though the clock keeps running while the
 * operator is answering. RA-351 makes `canChangeDueDate` true in `queried`;
 * management-be gains the matching transitions from that state (epr-8wz4.1)
 * and management-fe mirrors the gate (epr-8wz4.2). This spec proves the whole
 * thing end-to-end.
 *
 * RA-572 RETIRED THE OVERRIDE FLOW, so this file's original AC1-override case
 * and its whole AC3 block are gone with the feature they covered rather than
 * being reworked — Change is now the single route for amending a deadline.
 * The absence of the override affordance is covered once, by
 * ra-572-hide-override.e2e.js; repeating it here would add nothing.
 *
 *   - AC1: a queried re-accreditation item shows the "Change determination
 *          deadline" link (action-sla-extend, /work-items/{id}/sla/extend).
 *   - AC2: from queried the deadline can be changed, and the due date moves.
 *
 * DRIVING TO `queried` WITH A LIVE SLA CLOCK. The item is taken
 * submitted -> duly-made -> assessment-in-progress -> queried. Going through
 * assessment is not incidental: `dulyMake` starts the 12-week SLA clock from
 * the payment date, so by the time the query is raised there is a REAL due
 * date to move. A query straight from `submitted` would leave the item with
 * no clock, and AC2/AC3's "the due date changes" could not be observed.
 *
 * `raiseQuery` goes through the query UI (the caseworker's own action) and
 * leaves the item in `queried`, asserting that state before returning. A
 * deadline change is a due-date change, NOT a workflow transition through the
 * engine gate, so it does not move the item out of `queried` — which is why
 * AC1 and AC2 can both run against the one shared item, re-anchoring on the
 * `queried` state before each.
 */
describe('RA-351 Change the determination deadline from the queried state', () => {
  let workItemId

  before(async () => {
    await login.login()
    // uniquePostcode() gives a per-run-unique suffix (SW1A outward keeps the
    // England + plastic fixture routing) so repeat or parallel runs never
    // collide on the same seeded item.
    workItemId = await createReAccreditation(
      'RA351 Queried SLA Ltd',
      uniquePostcode()
    )

    // Start the SLA clock (dulyMake, from the payment date) then reach
    // assessment, the last state before the query.
    await dulyMake(workItemId)
    await startAssessment(workItemId)

    // Assessment -> queried, via the query UI.
    await raiseQuery(workItemId, {
      sections: ['business-plan'],
      reason: 'RA-351: please confirm the business plan figures.'
    })

    // Preconditions the ACs below depend on, asserted rather than assumed: the
    // item is genuinely in `queried`, and it carries a real due date (an em
    // dash here would make "the due date changed" vacuous).
    await detail.assertState('Queried')
    expect(await detail.hasRealDueOn()).toBe(true)

    await login.logout()
  })

  after(async () => {
    await login.logout()
  })

  describe('AC1 — the change-deadline link is offered in the queried state', () => {
    before(async () => {
      await login.login()
      await workItems.openWorkItem(workItemId)
      // Positive anchor: absence-style regressions aside, every assertion in
      // this block reads off the detail page, so prove it is the queried
      // detail page before trusting what it shows.
      await detail.assertState('Queried')
    })

    after(async () => {
      await login.logout()
    })

    it('offers the "Change determination deadline" link with the right href', async () => {
      await slaExtend.assertActionLinkFor(workItemId)
    })

    it('the change-deadline link actually opens the input page', async () => {
      // Presence + href is not the whole AC — the link has to go somewhere.
      await slaExtend.actionLink().click()
      await slaExtend.assertOnInputPage()
    })
  })

  describe('AC2 — change the determination deadline from queried', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('rejects an empty submission (validation mirror of RA-131)', async () => {
      // The cheap negative the existing SLA suite already carries: an empty
      // form must come back to the input page with an error summary rather
      // than silently applying nothing.
      await slaExtend.gotoFor(workItemId)
      await slaExtend.submitForm()
      await slaExtend.assertErrorSummaryDisplayed()
      await slaExtend.assertOnInputPage()
    })

    it('changes the due date and returns to the work item with a banner', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Queried')
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.gotoFor(workItemId)
      // RA-447 (CM6): the additionalDays count is replaced by an absolute
      // date, which must be after the item's CURRENT due date rather than a
      // fixed number of days from today — see sla-extend-date.js.
      await slaExtend.fillForm({
        reason: 'RA-351: operator needs more time to answer the query',
        date: farFutureDeadline()
      })
      await slaExtend.submitForm()
      await slaExtend.waitForDetailUrl(workItemId)

      // The PRG back to the detail page always flashes a banner on success.
      await detail.assertFlashBanner()

      // AC2: the due date actually moved. Waited rather than read once because
      // the value is read immediately after the redirect re-renders the header.
      await browser.waitUntil(
        async () =>
          (await detail.caseHeaderFieldText('dueOn')).trim() !== before,
        {
          timeout: 10000,
          timeoutMsg: `Expected the due date to change from "${before}" after changing the determination deadline`
        }
      )

      // This is a due-date change, not a transition — the item stays queried.
      await detail.assertState('Queried')
    })
  })
})
