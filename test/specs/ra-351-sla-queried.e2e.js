import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import slaOverride from '../page-objects/sla-override.page.js'
import {
  createReAccreditation,
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'
import { raiseQuery } from '../support/query-resubmission.js'

/**
 * RA-351 — Extend / Override SLA are available in the `queried` state.
 *
 * The bug: "On queried state, there is no option to Extend SLA or Override
 * SLA." The two due-date links live in the work-item detail page's ASSIGNMENT
 * panel, gated on `canChangeDueDate`. Before RA-351 that predicate was false
 * for `queried`, so a caseworker who had queried an application could no
 * longer move its SLA clock — even though the clock keeps running while the
 * operator is answering. RA-351 makes `canChangeDueDate` true in `queried`;
 * management-be gains the matching `sla-extend` / `sla-override` transitions
 * from that state (epr-8wz4.1) and management-fe mirrors the gate
 * (epr-8wz4.2). This spec proves the whole thing end-to-end.
 *
 *   - AC1: a queried re-accreditation item shows BOTH the "Change the due
 *          date" link (action-sla-extend, /work-items/{id}/sla/extend) and
 *          the "Override the due date" link (action-sla-override,
 *          /work-items/{id}/sla/override).
 *   - AC2: from queried the SLA can be extended, and the due date moves.
 *   - AC3: from queried the SLA can be overridden, and the due date moves.
 *
 * DRIVING TO `queried` WITH A LIVE SLA CLOCK. The item is taken
 * submitted -> duly-made -> assessment-in-progress -> queried. Going through
 * assessment is not incidental: `dulyMake` starts the 12-week SLA clock from
 * the payment date, so by the time the query is raised there is a REAL due
 * date to move. A query straight from `submitted` would leave the item with
 * no clock, and AC2/AC3's "the due date changes" could not be observed.
 *
 * `raiseQuery` goes through the query UI (the caseworker's own action) and
 * leaves the item in `queried`, asserting that state before returning. SLA
 * extend/override are due-date changes, NOT workflow transitions through the
 * engine gate, so they do not move the item out of `queried` — which is why
 * AC1/AC2/AC3 can all run against the one shared item, re-anchoring on the
 * `queried` state before each.
 */
describe('RA-351 Extend / Override SLA from the queried state', () => {
  let workItemId

  before(async () => {
    await login.login()
    // Postcode suffix `1AZ` is unused across the suite for England + plastic;
    // see the fixture rule in support/re-accreditation-journey.js.
    workItemId = await createReAccreditation(
      'RA351 Queried SLA Ltd',
      'SW1A 1AZ'
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

  describe('AC1 — the due-date links are offered in the queried state', () => {
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

    it('offers the "Change the due date" (Extend SLA) link with the right href', async () => {
      await slaExtend.assertActionLinkFor(workItemId)
    })

    it('offers the "Override the due date" (Override SLA) link with the right href', async () => {
      await slaOverride.assertActionLinkFor(workItemId)
    })

    it('the extend link actually opens the extend input page', async () => {
      // Presence + href is not the whole AC — the link has to go somewhere.
      await slaExtend.actionLink().click()
      await slaExtend.assertOnInputPage()
    })

    it('the override link actually opens the override input page', async () => {
      await workItems.openWorkItem(workItemId)
      await slaOverride.actionLink().click()
      await slaOverride.assertOnInputPage()
    })
  })

  describe('AC2 — extend the SLA from queried', () => {
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

    it('extends the due date and returns to the work item with a banner', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Queried')
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.gotoFor(workItemId)
      await slaExtend.fillForm({
        reason: 'RA-351: operator needs more time to answer the query',
        additionalDays: 7
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
          timeoutMsg: `Expected the due date to change from "${before}" after extending the SLA`
        }
      )

      // Extending is a due-date change, not a transition — the item stays queried.
      await detail.assertState('Queried')
    })
  })

  describe('AC3 — override the SLA from queried', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('rejects an empty submission (validation mirror of RA-131)', async () => {
      await slaOverride.gotoFor(workItemId)
      await slaOverride.submitForm()
      await slaOverride.assertErrorSummaryDisplayed()
      await slaOverride.assertOnInputPage()
    })

    it('overrides the due date and returns to the work item with a banner', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Queried')
      const before = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaOverride.gotoFor(workItemId)
      await slaOverride.fillForm({
        reason: 'RA-351: resetting the SLA target while the query is open',
        newTargetDays: 120
      })
      await slaOverride.submitForm()
      await slaOverride.waitForDetailUrl(workItemId)

      await detail.assertFlashBanner()

      // AC3: the due date actually moved. 120 days is deliberately clear of the
      // default 12-week (84-day) target and of the +7 the extend above applied,
      // so the override lands on a distinct date whichever order these run in.
      await browser.waitUntil(
        async () =>
          (await detail.caseHeaderFieldText('dueOn')).trim() !== before,
        {
          timeout: 10000,
          timeoutMsg: `Expected the due date to change from "${before}" after overriding the SLA`
        }
      )

      await detail.assertState('Queried')
    })
  })
})
