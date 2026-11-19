import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail, {
  PAYMENT_NOT_RECEIVED
} from '../page-objects/work-item-detail.page.js'
import {
  createReAccreditation,
  dulyMake
} from '../support/re-accreditation-journey.js'
import { formatUkHeaderDate, utcDateParts } from '../support/uk-time.js'

/**
 * RA-493 — Case Management service: Display Duly Made payment information
 * on the Application Summary Header Panel.
 *
 * The case header's meta line gains "Payment date" and "Charge":
 *
 *   AC01 — once a payment date is recorded, it is shown on the header.
 *   AC02 — the charge is shown alongside it.
 *   AC03 — both reflect what is currently recorded against the application.
 *   AC04 — before the application is duly made, the date reads "Not received".
 *
 * management-fe renders both from the work item payload: the date from
 * `payload.paymentDate` (stamped by the duly-making POST), the charge from
 * `payload.chargeAmountPence` through the same formatter as the duly-making
 * page — always with pence ("£546.00", "£1,234.56"; user decision
 * 2026-11-18). Duly making records no amount paid, so (RA-495, user
 * 2026-11-19) the charge is the amount owed, shown from submission, and the
 * payment date alone says whether it has been paid. An item with no charge
 * at all shows the em dash.
 *
 * WHY THE PAYMENT DATE IS BACK-DATED. Duly making with today's date would
 * pass against a header that rendered "today" from the clock rather than the
 * recorded value. Three days back is unambiguously the ENTERED date, and still
 * inside the "today or in the past, within 12 months" validation window.
 *
 * WHY THE AMOUNT HAS PENCE. 123456 pence renders "£1,234.56", which pins the
 * pounds/pence division (undivided it would be "£123,456"), the thousands
 * separator and the part-pound decimals in one exact string. It is also a
 * figure no other spec creates, so the header cannot be borrowing a value
 * from elsewhere, and it clears the 50000-pence floor documented on
 * `createReAccreditation`.
 */
const PAYMENT_DAY_OFFSET = -3
const CHARGE_AMOUNT_PENCE = 123456
const EXPECTED_AMOUNT = '£1,234.56'

/**
 * The header date for a payment entered `dayOffset` days from today.
 *
 * `dulyMake` fills the form from `utcDateParts`, and management-be records
 * that calendar date as-is (a date-only `yyyy-MM-dd`). Rebuilding it at UTC
 * midnight and formatting in Europe/London lands on the same calendar day all
 * year round (London is UTC or UTC+1, never behind), so this is an exact
 * expectation with no tolerance window.
 */
function expectedPaymentDate(dayOffset) {
  const { day, month, year } = utcDateParts(new Date(), dayOffset)
  return formatUkHeaderDate(
    new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  )
}

describe('RA-493 Duly Made payment information on the case header', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('an application that has a charge', () => {
    // ORDERING IS LOAD-BEARING. Duly making is one-way, so the AC04
    // "Not received" assertions must run against this item BEFORE the
    // AC01–AC03 block duly makes it.
    let workItemId

    before(async () => {
      workItemId = (
        await createReAccreditation('RA-493 Header Payment Ltd', {
          chargeAmountPence: CHARGE_AMOUNT_PENCE
        })
      ).id
    })

    describe('AC04 — before it is duly made', () => {
      before(async () => {
        await workItems.openWorkItem(workItemId)
        // Precondition, asserted rather than assumed: `submitted` displays
        // as "Not started".
        await detail.assertState('Not started')
      })

      it('shows "Not received" for the payment date', async () => {
        await expect(detail.caseHeaderField('paymentDate')).toHaveText(
          PAYMENT_NOT_RECEIVED
        )
      })

      it('shows the charge, known from submission, beside it', async () => {
        await expect(detail.caseHeaderField('charge')).toHaveText(
          EXPECTED_AMOUNT
        )
      })
    })

    describe('AC01–AC03 — once it is duly made', () => {
      before(async () => {
        await dulyMake(workItemId, { dayOffset: PAYMENT_DAY_OFFSET })
        // Re-open rather than reading the post-redirect page, so the values
        // asserted are the ones read back from management-be on a fresh
        // request — "what is currently recorded" (AC03), not leftover state
        // from the duly-making form.
        await workItems.openWorkItem(workItemId)
      })

      it('AC01: shows the recorded payment date', async () => {
        await expect(detail.caseHeaderField('paymentDate')).toHaveText(
          expectedPaymentDate(PAYMENT_DAY_OFFSET)
        )
      })

      it('AC01: shows the ENTERED date, not today', async () => {
        // Guards against a header that formats "now" (or the completion
        // timestamp) instead of the recorded payment date — the exact-match
        // above would also catch it, but this names the failure.
        await expect(detail.caseHeaderField('paymentDate')).not.toHaveText(
          expectedPaymentDate(0)
        )
      })

      it('AC02/AC03: shows the recorded charge', async () => {
        await expect(detail.caseHeaderField('charge')).toHaveText(
          EXPECTED_AMOUNT
        )
      })

      it('AC01/AC02: carries the values on the other case tabs too', async () => {
        // The header is shared by the summary, Application History and
        // Additional information pages; a tab that built it from a different
        // payload read would regress silently on the summary-only checks.
        await detail.gotoAudit()
        await expect(detail.caseHeaderField('paymentDate')).toHaveText(
          expectedPaymentDate(PAYMENT_DAY_OFFSET)
        )
        await expect(detail.caseHeaderField('charge')).toHaveText(
          EXPECTED_AMOUNT
        )
      })
    })
  })

  describe('an application duly made without a recorded charge', () => {
    // Negative path: an item created with no `chargeAmountPence` has a
    // payment date once duly made but no charge to show. management-fe
    // renders the em dash — it must NOT fall back to "Not received", which
    // would contradict the payment date shown beside it.
    let workItemId

    before(async () => {
      workItemId = (await createReAccreditation('RA-493 No Charge Ltd')).id
      await dulyMake(workItemId, { dayOffset: PAYMENT_DAY_OFFSET })
      await workItems.openWorkItem(workItemId)
    })

    it('still shows the recorded payment date', async () => {
      await expect(detail.caseHeaderField('paymentDate')).toHaveText(
        expectedPaymentDate(PAYMENT_DAY_OFFSET)
      )
    })

    it('shows the em dash for the charge rather than "Not received"', async () => {
      await expect(detail.caseHeaderField('charge')).toHaveText('—')
    })
  })
})
