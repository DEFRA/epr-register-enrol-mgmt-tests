import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'
import { farFutureDeadline } from '../support/sla-extend-date.js'
import { formatUkHeaderDate, utcDateParts } from '../support/uk-time.js'

const TYPE_ID = 'add-overseas-site'

/** The add-ORS SLA, as re-accreditation's: 84 days from the payment date. */
const SLA_DAYS = 84

/** management-be lists the related change requests by application reference. */
function inReferenceOrder(rows) {
  return rows.toSorted((a, b) => (a.reference < b.reference ? -1 : 1))
}

/**
 * RA-495 AC4. An assigned caseworker duly makes one Not started add-ORS work
 * item on its own, through the shared Duly make page, mirroring the RA-316
 * duly-making specs:
 *
 *  - the Duly make CTA on the detail page while Not started, and not after;
 *  - the page shows the site's own charge, the operator's payment reference
 *    and every change request from the same submission, this one included,
 *    in application reference order, with their current status (user
 *    decision 2026-11-18);
 *  - payment date validation as for re-accreditation;
 *  - afterwards: status Duly made, the payment date in the header, the due
 *    date 84 days from the payment date, and the duly make in Application
 *    history; the other site is untouched;
 *  - the due date can then be changed, and that is in the history too
 *    (deferred here from the RA-495 assignment spec).
 *
 * Submitted straight to management-be, as the operator backend does.
 * ORDERING IS LOAD-BEARING: duly making is one-way, so the checks on the Not
 * started item run before the duly make.
 */
describe('RA-495 add-ORS duly making', () => {
  let submission
  let first
  let second
  const paymentDate = new Date(Date.now() - 3 * 86_400_000)

  before(async () => {
    submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA495 Add ORS Duly Make Ltd',
      siteCount: 2
    })
    ;[first, second] = submission.workItems
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('before duly making', () => {
    it('offers Duly make on the Not started application once it is assigned', async () => {
      await workItems.openWorkItem(first.id)
      await detail.assertState('Not started')
      await detail.selfAssign()
      expect(await detail.hasDulyMakeCta()).toBe(true)
    })

    it('opens the Duly make page from the CTA', async () => {
      await workItems.openWorkItem(first.id)
      await detail.clickDulyMake()
      await dulyMaking.waitForDulyMakingUrl(first.id, TYPE_ID)
      await dulyMaking.assertOnPage()
    })

    it("shows the site's own charge and the operator's payment reference", async () => {
      await dulyMaking.gotoFor(first.id, TYPE_ID)
      expect((await dulyMaking.chargeAmountText()).trim()).toBe('£328.00')
      expect((await dulyMaking.paymentReferenceText()).trim()).toBe(
        submission.payload.paymentReference
      )
    })

    it('lists every change request from the same submission, this one included, with its status', async () => {
      await dulyMaking.gotoFor(first.id, TYPE_ID)
      await expect(dulyMaking.relatedSection()).toBeDisplayed()
      expect(await dulyMaking.relatedRows()).toEqual(
        inReferenceOrder(
          [first, second].map((workItem, index) => {
            const site = submission.sites[index]
            return {
              reference: workItem.applicationReference,
              site: `${site.siteName} (${site.orsId})`,
              type: 'Accreditation: add registered ORS',
              charge: '£328.00',
              status: 'Not started'
            }
          })
        )
      )
    })

    it('rejects a payment date in the future, as for re-accreditation', async () => {
      await dulyMaking.gotoFor(first.id, TYPE_ID)
      await dulyMaking.setPaymentDate(utcDateParts(new Date(), 1))
      await dulyMaking.submit()
      await dulyMaking.assertErrorSummary(
        'Payment date must be today or in the past'
      )
    })

    it('rejects a malformed payment date, as for re-accreditation', async () => {
      await dulyMaking.gotoFor(first.id, TYPE_ID)
      await dulyMaking.setPaymentDate({ day: '32', month: '2', year: '2026' })
      await dulyMaking.submit()
      await dulyMaking.assertErrorSummary('Payment date must be a real date')
    })

    it('leaves the application Not started after Cancel', async () => {
      await dulyMaking.gotoFor(first.id, TYPE_ID)
      await dulyMaking.cancel()
      await dulyMaking.waitForDetailUrl(first.id)
      await detail.assertState('Not started')
    })
  })

  describe('duly making', () => {
    before(async () => {
      await dulyMaking.gotoFor(first.id, TYPE_ID)
      await dulyMaking.setPaymentDate(utcDateParts(paymentDate))
      await dulyMaking.submit()
      await dulyMaking.waitForDetailUrl(first.id)
    })

    it('moves the application to Duly made and withdraws the CTA', async () => {
      await workItems.openWorkItem(first.id)
      await detail.assertState('Duly made')
      expect(await detail.hasDulyMakeCta()).toBe(false)
    })

    it('shows the payment date in the header', async () => {
      await workItems.openWorkItem(first.id)
      expect((await detail.caseHeaderFieldText('paymentDate')).trim()).toBe(
        formatUkHeaderDate(paymentDate)
      )
    })

    it('sets the due date 84 days from the payment date', async () => {
      await workItems.openWorkItem(first.id)
      await detail.assertCaseHeaderDueOn(
        new Date(paymentDate.getTime() + SLA_DAYS * 86_400_000)
      )
    })

    it('records the duly make in Application history', async () => {
      await workItems.openWorkItem(first.id)
      await detail.gotoAudit()
      await detail.assertAuditEntry('Action applied')
      expect(await detail.appliedTransitions()).toContain(
        'submitted → duly-made'
      )
    })

    it('leaves the other site Not started, and shows this one as Duly made from it', async () => {
      await workItems.openWorkItem(second.id)
      await detail.assertState('Not started')
      expect(await detail.hasDulyMakeCta()).toBe(true)

      await dulyMaking.gotoFor(second.id, TYPE_ID)
      const rows = await dulyMaking.relatedRows()
      expect(
        rows.map(({ reference, status }) => ({ reference, status }))
      ).toEqual(
        inReferenceOrder([
          { reference: first.applicationReference, status: 'Duly made' },
          { reference: second.applicationReference, status: 'Not started' }
        ])
      )
    })

    it('refuses the Duly make page once duly made', async () => {
      await dulyMaking.gotoFor(first.id, TYPE_ID)
      await dulyMaking.waitForDetailUrl(first.id)
      await detail.assertState('Duly made')
    })
  })

  describe('changing the due date after duly making', () => {
    it('changes the due date and records it in Application history', async () => {
      await workItems.openWorkItem(first.id)
      const previous = (await detail.caseHeaderFieldText('dueOn')).trim()

      await slaExtend.changeDeadline(first.id, {
        reason: 'RA-495 add-ORS deadline change',
        date: farFutureDeadline()
      })

      expect(await detail.waitForDueOnToChangeFrom(previous)).not.toBe(previous)
      await detail.gotoAudit()
      await detail.waitForAuditEntryCount('sla-extended', 1)
    })
  })
})
