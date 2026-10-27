import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import changePaymentDate from '../page-objects/change-payment-date.page.js'
import {
  createReAccreditation,
  dulyMake
} from '../support/re-accreditation-journey.js'
import { withdrawAsOperatorOrThrow } from '../support/operator-withdrawal.js'
import { formatUkHeaderDate, utcDateParts } from '../support/uk-time.js'

/**
 * RA-576 — change the payment date after an application is duly made.
 *
 * A caseworker can correct the payment date entered at duly making, with a
 * mandatory reason. Only `payload.paymentDate` and the audit trail change:
 * the status and the SLA clock ("Due on") stay exactly as they were.
 *
 * Covered here:
 *   AC01 — the date can be changed, and changed again.
 *   AC02 — closed (terminal) applications offer no link and the URL refuses.
 *   AC03 — a reason is mandatory.
 *   AC04 — the case header shows the new date.
 *   AC05 — status and "Due on" are unchanged.
 *   AC06 — the history records previous date, new date and reason.
 *
 * ORDERING IS LOAD-BEARING within the main describe: the item moves through
 * original date -> first change -> second change, and each step asserts
 * against the one before.
 */

const ORIGINAL_OFFSET = -10
const FIRST_CHANGE_OFFSET = -5
const SECOND_CHANGE_OFFSET = -2

/** `dd/mm/yyyy`, as shown on the change page. */
function pageDate(dayOffset) {
  const { day, month, year } = utcDateParts(new Date(), dayOffset)
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`
}

/** The case header's short GDS form, e.g. "15 Jul 2026". */
function headerDate(dayOffset) {
  const { day, month, year } = utcDateParts(new Date(), dayOffset)
  return formatUkHeaderDate(
    new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  )
}

describe('RA-576 change payment date', () => {
  let workItemId
  let dueOnBefore

  before(async () => {
    await login.login()
    ;({ id: workItemId } = await createReAccreditation('Change Payment Ltd', {
      chargeAmountPence: 109200
    }))
    await dulyMake(workItemId, { dayOffset: ORIGINAL_OFFSET })
    await workItems.openWorkItem(workItemId)
    dueOnBefore = (await detail.caseHeaderFieldText('dueOn')).trim()
    await login.logout()
  })

  describe('AC01 — the page', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('offers a "Change payment date" link on a duly made item', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Duly made')
      expect(await detail.hasChangePaymentDateLink()).toBe(true)
    })

    it('shows the current payment date, a date entry and a reason', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.clickChangePaymentDate()
      await changePaymentDate.waitForChangePaymentDateUrl(workItemId)
      await changePaymentDate.assertOnPage()

      expect(await changePaymentDate.currentPaymentDateText()).toContain(
        `The current payment date is ${pageDate(ORIGINAL_OFFSET)}`
      )
      await expect(changePaymentDate.dayInput()).toBeDisplayed()
      await expect(changePaymentDate.monthInput()).toBeDisplayed()
      await expect(changePaymentDate.yearInput()).toBeDisplayed()
      await expect(changePaymentDate.reasonInput()).toBeDisplayed()
      expect((await changePaymentDate.submitButtonText()).trim()).toBe('Save')
    })

    it('Cancel returns to the application and changes nothing', async () => {
      await changePaymentDate.cancel()
      await changePaymentDate.waitForDetailUrl(workItemId)
      await expect(detail.caseHeaderField('paymentDate')).toHaveText(
        headerDate(ORIGINAL_OFFSET)
      )
      await detail.assertNoFlashBanner()
    })
  })

  describe('AC03 — validation', () => {
    before(async () => {
      await login.login()
      await changePaymentDate.gotoFor(workItemId)
    })

    after(async () => {
      await login.logout()
    })

    it('blocks a save with no reason', async () => {
      await changePaymentDate.setPaymentDate(
        utcDateParts(new Date(), FIRST_CHANGE_OFFSET)
      )
      await changePaymentDate.setReason('')
      await changePaymentDate.submit()

      await changePaymentDate.assertErrorSummary(
        'Enter a reason for the payment date change'
      )
      expect(await changePaymentDate.errorSummaryLinkHrefs()).toContain(
        '#reason'
      )
    })

    it('blocks a save with a reason over 200 words', async () => {
      await changePaymentDate.setPaymentDate(
        utcDateParts(new Date(), FIRST_CHANGE_OFFSET)
      )
      await changePaymentDate.setReason(
        Array.from({ length: 201 }, () => 'word').join(' ')
      )
      await changePaymentDate.submit()

      await changePaymentDate.assertErrorSummary(
        'Reason must be 200 words or fewer'
      )
    })

    it('blocks a save with no date, reporting the reason problem too', async () => {
      await changePaymentDate.setPaymentDate({})
      await changePaymentDate.setReason('')
      await changePaymentDate.submit()

      await changePaymentDate.assertErrorSummary('Enter the payment date')
      await changePaymentDate.assertErrorSummary(
        'Enter a reason for the payment date change'
      )
    })

    it('blocks a future date', async () => {
      await changePaymentDate.setPaymentDate(utcDateParts(new Date(), 3))
      await changePaymentDate.setReason('Wrong date')
      await changePaymentDate.submit()

      await changePaymentDate.assertErrorSummary(
        'Payment date must be today or in the past'
      )
    })

    it('left the payment date untouched', async () => {
      await workItems.openWorkItem(workItemId)
      await expect(detail.caseHeaderField('paymentDate')).toHaveText(
        headerDate(ORIGINAL_OFFSET)
      )
    })
  })

  describe('AC01/AC04/AC05/AC06 — changing the date', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('AC01: saves, returns to the application and confirms the update', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.clickChangePaymentDate()
      await changePaymentDate.assertOnPage()
      await changePaymentDate.setPaymentDate(
        utcDateParts(new Date(), FIRST_CHANGE_OFFSET)
      )
      await changePaymentDate.setReason('Operator keyed the wrong date.')
      await changePaymentDate.submit()

      await changePaymentDate.waitForDetailUrl(workItemId)
      await detail.assertFlashBanner()
      expect(await detail.flashBannerText()).toContain(
        'The payment date has been updated'
      )
    })

    it('AC04: shows the new payment date in the case header', async () => {
      await workItems.openWorkItem(workItemId)
      await expect(detail.caseHeaderField('paymentDate')).toHaveText(
        headerDate(FIRST_CHANGE_OFFSET)
      )
    })

    it('AC05: leaves the status and "Due on" as they were', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Duly made')
      expect((await detail.caseHeaderFieldText('dueOn')).trim()).toBe(
        dueOnBefore
      )
    })

    it('AC01: allows the date to be changed again', async () => {
      await workItems.openWorkItem(workItemId)
      expect(await detail.hasChangePaymentDateLink()).toBe(true)
      await detail.clickChangePaymentDate()
      await changePaymentDate.assertOnPage()
      // The page now reports the first change as the current date.
      expect(await changePaymentDate.currentPaymentDateText()).toContain(
        pageDate(FIRST_CHANGE_OFFSET)
      )
      await changePaymentDate.setPaymentDate(
        utcDateParts(new Date(), SECOND_CHANGE_OFFSET)
      )
      await changePaymentDate.setReason(
        'Corrected again after checking the bank.'
      )
      await changePaymentDate.submit()

      await changePaymentDate.waitForDetailUrl(workItemId)
      await expect(detail.caseHeaderField('paymentDate')).toHaveText(
        headerDate(SECOND_CHANGE_OFFSET)
      )
      expect((await detail.caseHeaderFieldText('dueOn')).trim()).toBe(
        dueOnBefore
      )
    })

    it('AC06: records each change in the history, not as a state change', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()

      // The summary must not read as a state change.
      expect(await detail.appliedTransitions()).not.toContain(
        'Duly made → Duly made'
      )
      await detail.assertAuditDetailRow(
        'payment-date-changed',
        'Previous payment date',
        pageDate(FIRST_CHANGE_OFFSET)
      )
      await detail.assertAuditDetailRow(
        'payment-date-changed',
        'New payment date',
        pageDate(SECOND_CHANGE_OFFSET)
      )
      await detail.assertAuditDetailRow(
        'payment-date-changed',
        'Reason',
        'Corrected again after checking the bank.'
      )
      await detail.assertAuditDetailRow(
        'payment-date-changed',
        'Reason',
        'Operator keyed the wrong date.'
      )
    })
  })

  describe('AC02 — a closed application cannot be changed', () => {
    let closedId

    before(async () => {
      await login.login()
      ;({ id: closedId } = await createReAccreditation('Closed Payment Ltd', {
        chargeAmountPence: 163800
      }))
      await dulyMake(closedId, { dayOffset: ORIGINAL_OFFSET })
      // Closed by withdrawal rather than a determination: it is terminal
      // all the same, and avoids a second determination (which pushes to the
      // operator journey) running alongside the other specs.
      await withdrawAsOperatorOrThrow(closedId, 'Withdrawn by the operator')
    })

    after(async () => {
      await login.logout()
    })

    it('offers no "Change payment date" link', async () => {
      await workItems.openWorkItem(closedId)
      await detail.assertState('Withdrawn')
      expect(await detail.hasChangePaymentDateLink()).toBe(false)
    })

    it('redirects the URL back to the application', async () => {
      await changePaymentDate.gotoFor(closedId)
      await changePaymentDate.waitForDetailUrl(closedId)
      await detail.assertState('Withdrawn')
    })
  })

  describe('AC02 — an application not yet duly made has no payment date', () => {
    let submittedId

    before(async () => {
      await login.login()
      ;({ id: submittedId } = await createReAccreditation('Unpaid Ltd', {
        chargeAmountPence: 54600
      }))
    })

    after(async () => {
      await login.logout()
    })

    it('offers no link and refuses the URL', async () => {
      await workItems.openWorkItem(submittedId)
      expect(await detail.hasChangePaymentDateLink()).toBe(false)

      await changePaymentDate.gotoFor(submittedId)
      await changePaymentDate.waitForDetailUrl(submittedId)
      await detail.assertState('Not started')
    })
  })
})
