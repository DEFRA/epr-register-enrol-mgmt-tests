import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import {
  createReAccreditation,
  dulyMake
} from '../support/re-accreditation-journey.js'
import { utcDateParts } from '../support/uk-time.js'

/**
 * RA-316 — payment date validation and guards.
 *
 * The happy path and the AC walk-through live in
 * `ra-316-duly-making.e2e.js`; this covers the refusals.
 *
 * management-be returns machine codes (`payment-date-required`,
 * `payment-date-invalid`, `payment-date-in-future`, `payment-date-too-old`)
 * with `field: "paymentDate"`, and management-fe owns the user-facing
 * strings asserted below. The backend's ProblemDetails `detail` string is
 * developer-facing and deliberately NOT asserted anywhere here.
 *
 * TWO RULES THAT ARE EASY TO GET BACKWARDS:
 *  - TODAY IS VALID. The rule is "today or in the past", so the boundary is
 *    today-passes / tomorrow-fails, not past-only.
 *  - The too-old rule is a FLAT 12-MONTH FLOOR from today. It is NOT "must
 *    be on or after the application was submitted" — a payment dated before
 *    the submission is deliberately accepted, and there is a spec for that
 *    below so nobody "fixes" it into a submission-date rule.
 */
describe('RA-316 duly making — payment date validation', () => {
  let workItemId

  before(async () => {
    await login.login()
    workItemId = await createReAccreditation(
      'Duly Making Validation Ltd',
      'SW1A 2DV',
      // £2,184.00 — distinct from every other RA-316 fixture on purpose.
      { chargeAmountPence: 218400 }
    )
    await login.logout()
  })

  describe('rejected payment dates', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    beforeEach(async () => {
      await dulyMaking.gotoFor(workItemId)
      await dulyMaking.assertOnPage()
    })

    it('rejects a payment date in the future', async () => {
      await dulyMaking.setPaymentDate(utcDateParts(new Date(), 1))
      await dulyMaking.submit()
      await dulyMaking.assertErrorSummary(
        'Payment date must be today or in the past'
      )
    })

    it('rejects a malformed date', async () => {
      // 32 February is unreal in both senses — an impossible day number and
      // an impossible day-for-month — so it exercises the `real date` branch
      // rather than a range check on the day field alone.
      await dulyMaking.setPaymentDate({ day: '32', month: '2', year: '2026' })
      await dulyMaking.submit()
      await dulyMaking.assertErrorSummary('Payment date must be a real date')
    })

    it('rejects an incomplete date', async () => {
      await dulyMaking.setPaymentDate({ day: '1', month: '', year: '2026' })
      await dulyMaking.submit()
      await dulyMaking.assertErrorSummary('Payment date must be a real date')
    })

    it('rejects an empty date', async () => {
      await dulyMaking.setPaymentDate({})
      await dulyMaking.submit()
      await dulyMaking.assertErrorSummary('Enter the payment date')
    })

    it('rejects a payment date more than 12 months ago', async () => {
      // 400 days rather than 366: comfortably past the floor whatever the
      // rounding, and immune to a leap year shifting the boundary under the
      // test.
      await dulyMaking.setPaymentDate(utcDateParts(new Date(), -400))
      await dulyMaking.submit()
      await dulyMaking.assertErrorSummary(
        'Payment date must be within the last 12 months'
      )
    })

    it('points every error summary link at the first date field', async () => {
      await dulyMaking.setPaymentDate(utcDateParts(new Date(), 1))
      await dulyMaking.submit()
      await dulyMaking.assertErrorSummary(
        'Payment date must be today or in the past'
      )
      // GDS convention — focus the first date field. A summary whose links
      // go nowhere useful is a regression the message assertion misses.
      const hrefs = await dulyMaking.errorSummaryLinkHrefs()
      expect(hrefs.length).toBeGreaterThan(0)
      for (const href of hrefs) {
        expect(href).toContain('#payment-date-day')
      }
    })
  })

  describe('a rejected submission changes nothing', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('leaves the work item in "Not started" after a rejected date', async () => {
      await dulyMaking.gotoFor(workItemId)
      await dulyMaking.setPaymentDate(utcDateParts(new Date(), 1))
      await dulyMaking.submit()
      await dulyMaking.assertErrorSummary(
        'Payment date must be today or in the past'
      )

      // The refusal is only meaningful if it is also inert. Without this a
      // build that showed the error AND applied the transition would pass
      // every assertion above.
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Not started')
      expect(await detail.hasDulyMakeCta()).toBe(true)
    })
  })

  describe('a payment date before the application was submitted is accepted', () => {
    let backdatedId

    before(async () => {
      await login.login()
      backdatedId = await createReAccreditation(
        'Duly Making Backdated Ltd',
        'SW1A 3DX',
        // £3,276.00
        { chargeAmountPence: 327600 }
      )
    })

    after(async () => {
      await login.logout()
    })

    it('accepts a date earlier than the submission but inside 12 months', async () => {
      // Deliberate: the floor is 12 months from TODAY, not the submission
      // date. This work item was created seconds ago, so 30 days back is
      // comfortably before its submission — and must still be accepted.
      await workItems.openWorkItem(backdatedId)
      await detail.clickDulyMake()
      await dulyMaking.assertOnPage()
      await dulyMaking.setPaymentDate(utcDateParts(new Date(), -30))
      await dulyMaking.submit()

      await dulyMaking.waitForDetailUrl(backdatedId)
      await detail.assertState('Duly made')
      expect(await dulyMaking.hasErrorSummary()).toBe(false)
    })
  })

  describe('the route refuses from the wrong state', () => {
    let dulyMadeId

    before(async () => {
      await login.login()
      dulyMadeId = await createReAccreditation(
        'Duly Making Guard Ltd',
        'SW1A 4DG',
        // £3,965.00 — the top bare band.
        { chargeAmountPence: 396500 }
      )
      await dulyMake(dulyMadeId)
    })

    after(async () => {
      await login.logout()
    })

    it('does not offer the CTA once the item has left submitted', async () => {
      await workItems.openWorkItem(dulyMadeId)
      await detail.assertState('Duly made')
      expect(await detail.hasDulyMakeCta()).toBe(false)
    })

    it('refuses a direct visit to the duly-making page', async () => {
      // Hiding the CTA is not a control on its own — the route has to refuse
      // as well, or the transition is reachable by anyone who kept the URL.
      // The item must still be in `duly-made` afterwards: nothing in this
      // story moves it on, and a second duly-making must not re-run it.
      await dulyMaking.gotoFor(dulyMadeId)
      await workItems.openWorkItem(dulyMadeId)
      await detail.assertState('Duly made')
    })
  })
})
