import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import {
  createReAccreditation,
  dulyMake
} from '../support/re-accreditation-journey.js'
import { raiseQuery, resumeFromQuery } from '../support/query-resubmission.js'

/**
 * RA-766 — the charge follows the application through a query.
 *
 * Answering a query can change the tonnage band or the overseas sites. The
 * operator backend recalculates the charge (it is the only place the charge is
 * calculated) and sends `chargeAmountPence` on `resume-from-query`. Case
 * management used to drop it, so the duly-making page kept showing the charge
 * from the original submission.
 *
 * Three things are pinned here, each on its own work item so no spec borrows a
 * figure from another:
 *
 *   1. A changed charge is saved and is what the duly-making page shows.
 *   2. A resubmission that sends no charge leaves the stored one alone.
 *   3. A work item that was already duly made is corrected too (the header's
 *      payment amount follows), because the charge is paid after the query.
 *
 * The figures are all at or above the 50000-pence floor documented on
 * `createReAccreditation`, and all differ, so a factor-of-100 slip in either
 * direction shows as a wrong magnitude rather than passing.
 *
 * The operator's answer goes straight to management-be (see
 * `support/query-resubmission.js`): there is no case-management affordance for
 * it by design. That the real operator backend sends the right number is the
 * contract test in epr-register-enrol-backend, not this spec's business.
 */
const ORIGINAL_CHARGE_PENCE = 218400 // £2,184.00
const RECALCULATED_CHARGE_PENCE = 327600 // £3,276.00
const UNTOUCHED_CHARGE_PENCE = 163800 // £1,638.00
const DULY_MADE_ORIGINAL_PENCE = 273000 // £2,730.00
const DULY_MADE_RECALCULATED_PENCE = 429300 // £4,293.00

const pounds = (pence) => pence / 100

describe('RA-766 the charge follows the application through a query', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('a query answered before the application is duly made', () => {
    let workItemId

    before(async () => {
      workItemId = (
        await createReAccreditation('RA-766 Recalculated Charge Ltd', {
          chargeAmountPence: ORIGINAL_CHARGE_PENCE
        })
      ).id
      // Queried while still pre-duly-made, so it comes back to `updated` with
      // the duly-making CTA (see ra-316-duly-making-from-updated.e2e.js).
      await raiseQuery(workItemId, {
        sections: ['prn-tonnage'],
        reason: 'Please confirm the planned tonnage band.'
      })
      await resumeFromQuery(workItemId, {
        sectionKeys: ['prn-tonnage'],
        chargeAmountPence: RECALCULATED_CHARGE_PENCE
      })
    })

    it('shows the recalculated charge on the duly-making page, not the original', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('updated')
      expect(await detail.hasDulyMakeCta()).toBe(true)

      await detail.clickDulyMake()
      await dulyMaking.waitForDulyMakingUrl(workItemId)
      await dulyMaking.assertOnPage()

      // The magnitude, not just the text: undivided pence would read
      // "£327,600.00", which a currency-shaped text match cannot tell apart.
      expect(await dulyMaking.chargeAmountPounds()).toBe(
        pounds(RECALCULATED_CHARGE_PENCE)
      )
      expect(await dulyMaking.chargeAmountPounds()).not.toBe(
        pounds(ORIGINAL_CHARGE_PENCE)
      )
    })
  })

  describe('a resubmission that sends no charge', () => {
    let workItemId

    before(async () => {
      workItemId = (
        await createReAccreditation('RA-766 Untouched Charge Ltd', {
          chargeAmountPence: UNTOUCHED_CHARGE_PENCE
        })
      ).id
      await raiseQuery(workItemId, {
        sections: ['business-plan'],
        reason: 'Please resend the business plan.'
      })
      // No chargeAmountPence: an operator backend that predates RA-766, or an
      // application with no tonnage band. It must never clear the stored one.
      await resumeFromQuery(workItemId, { sectionKeys: ['business-plan'] })
    })

    it('keeps the stored charge on the duly-making page', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.clickDulyMake()
      await dulyMaking.waitForDulyMakingUrl(workItemId)
      await dulyMaking.assertOnPage()

      expect(await dulyMaking.chargeAmountPounds()).toBe(
        pounds(UNTOUCHED_CHARGE_PENCE)
      )
    })
  })

  describe('a query answered after the application is duly made', () => {
    let workItemId

    before(async () => {
      workItemId = (
        await createReAccreditation('RA-766 Duly Made Charge Ltd', {
          chargeAmountPence: DULY_MADE_ORIGINAL_PENCE
        })
      ).id
      await dulyMake(workItemId)
      await raiseQuery(workItemId, {
        sections: ['prn-tonnage'],
        reason: 'Please confirm the planned tonnage band.'
      })
      await resumeFromQuery(workItemId, {
        sectionKeys: ['prn-tonnage'],
        chargeAmountPence: DULY_MADE_RECALCULATED_PENCE
      })
    })

    it('updates the payment amount on the case header', async () => {
      await workItems.openWorkItem(workItemId)

      // Whole pounds print without decimals (see ra-493-header-payment-info).
      await expect(detail.caseHeaderField('paymentAmount')).toHaveText('£4,293')
    })
  })
})
