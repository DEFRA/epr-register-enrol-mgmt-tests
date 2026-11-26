import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import decision, { todayInUk } from '../page-objects/decision.page.js'
import confirmContact from '../page-objects/confirm-contact.page.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'
import { getWorkItem } from '../support/decision-api.js'
import { dulyMake, logDecision } from '../support/standard-lifecycle-journey.js'

const TYPE_ID = 'add-overseas-site'

/** `{ day, month, year }` as `YYYY-MM-DD`, as management-be stores it. */
const isoDate = ({ day, month, year }) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/** The Europe/London calendar date of an instant, as `YYYY-MM-DD`. */
const ukIsoDateOf = (instant) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
    new Date(instant)
  )

const PENDING_BANNER_SENTENCE = (outcome) =>
  `The application was ${outcome}. You now need to contact the applicant about the decision.`

/**
 * While a determination awaits applicant contact, only Reassign, Unassign and
 * Confirm applicant contact are offered.
 */
async function assertOnlyPendingContactAffordances(workItemId) {
  expect(await detail.confirmApplicantContactCtaText()).toBe(
    'Confirm applicant contact'
  )
  expect(await detail.confirmApplicantContactHref()).toContain(
    `/work-items/${TYPE_ID}/${workItemId}/confirm-contact`
  )
  expect(await detail.hasAssignmentControl('reassign')).toBe(true)
  expect(await detail.hasAssignmentControl('unassign')).toBe(true)
  expect(await detail.hasLogDecisionCta()).toBe(false)
  expect(await detail.hasDulyMakeCta()).toBe(false)
  expect(await detail.hasAction('query')).toBe(false)
  expect(await detail.hasAction('sla-extend')).toBe(false)
}

/**
 * RA-495 AC5 and AC7. A Duly made add-ORS work item takes a final
 * determination (Approved or Refused, with an optional note) on the shared
 * Make determination page. It is final, the pending-contact banner prompts
 * for applicant contact, and it is in Application history. Mirrors the
 * ra-527 and ra-410 specs.
 *
 * No accreditation number is minted: the site joins an accreditation that
 * already exists.
 *
 * Submitted straight to management-be, as the operator backend does: two
 * sites from one submission, one approved and one refused. ORDERING IS
 * LOAD-BEARING: each step is one-way.
 *
 * Confirming applicant contact (AC6, AC8) pushes the outcome to the operator
 * journey first (RA-495 task 008). It holds no change request for an item
 * submitted straight to management-be, so contact cannot be confirmed here:
 * see ra-495-add-ors-status-push.e2e.js. Granted, Refused and the closed case
 * are covered from an operator's submission in the operator journey:
 * ra-495-add-ors-operator-journey.e2e.js.
 */
describe('RA-495 add-ORS determination', () => {
  let approval
  let refusal

  before(async () => {
    const submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA495 Add ORS Determination Ltd',
      siteCount: 2
    })
    ;[approval, refusal] = submission.workItems
    await login.login()
    await dulyMake(approval.id)
    await dulyMake(refusal.id)
  })

  after(async () => {
    await login.logout()
  })

  describe('a Duly made application', () => {
    it('offers Make Determination and Raise a query, and no other action', async () => {
      await workItems.openWorkItem(approval.id)
      await detail.assertState('Duly made')
      expect(await detail.hasLogDecisionCta()).toBe(true)
      expect((await detail.logDecisionCtaText()).trim()).toBe(
        'Make Determination'
      )
      // RA-698: Query is offered on a Duly made add-ORS item.
      expect(await detail.hasAction('query')).toBe(true)
      await expect(detail.noActionsMessage()).not.toBeExisting()
    })

    it('opens the Make determination page, which says the determination is final', async () => {
      await workItems.openWorkItem(approval.id)
      await detail.clickLogDecision()
      await decision.waitForDecisionUrl(approval.id, TYPE_ID)
      await decision.assertOnPage()
      expect(await decision.hasOutcomeRadio('approved')).toBe(true)
      expect(await decision.hasOutcomeRadio('refused')).toBe(true)
      expect(await decision.warningTextText()).toBe(
        'This determination is final and it cannot be changed.'
      )
    })

    it('asks for a decision when none is selected', async () => {
      await decision.gotoFor(approval.id, TYPE_ID)
      await decision.submit()
      await decision.assertErrorSummary()
      await workItems.openWorkItem(approval.id)
      await detail.assertState('Duly made')
    })

    // AC6: shown before a choice and on Approved, hidden on Refused.
    it('shows the effective date until Refused is selected', async () => {
      await decision.gotoFor(approval.id, TYPE_ID)
      expect(await decision.isEffectiveDateDisplayed()).toBe(true)
      await decision.selectOutcome('refused')
      expect(await decision.isEffectiveDateDisplayed()).toBe(false)
      await decision.selectOutcome('approved')
      expect(await decision.isEffectiveDateDisplayed()).toBe(true)
    })

    it('asks for the effective date on an approval without one', async () => {
      await decision.gotoFor(approval.id, TYPE_ID)
      await decision.selectOutcome('approved')
      await decision.submit()
      await decision.assertErrorSummary('Enter the valid from date')
      expect(await decision.effectiveDateErrorText()).toContain(
        'Enter the valid from date'
      )
      await workItems.openWorkItem(approval.id)
      await detail.assertState('Duly made')
    })
  })

  describe('approval', () => {
    before(async () => {
      await logDecision(approval.id, 'approved', {
        note: 'RA-495 site meets the conditions'
      })
    })

    it('tags the application "Approved" with the approval banner and no accreditation ID', async () => {
      await workItems.openWorkItem(approval.id)
      await detail.assertStateId('approved-pending-contact')
      expect(await detail.stateTagText()).toBe('Approved')
      expect(await detail.pendingContactBannerTitle()).toBe(
        'Application approved'
      )
      expect(await detail.pendingContactBannerText()).toBe(
        PENDING_BANNER_SENTENCE('approved')
      )
      expect(await detail.hasPendingContactAccreditationId()).toBe(false)
    })

    it('offers only Reassign, Unassign and Confirm applicant contact', async () => {
      await workItems.openWorkItem(approval.id)
      await assertOnlyPendingContactAffordances(approval.id)
    })

    it('cannot be changed: the Make determination page is refused', async () => {
      await decision.gotoFor(approval.id, TYPE_ID)
      await decision.waitForDetailUrl(approval.id)
      await detail.assertStateId('approved-pending-contact')
    })

    it('records the determination and its note in Application history', async () => {
      await workItems.openWorkItem(approval.id)
      await detail.gotoAudit()
      await detail.assertAuditEntry('Determination made: Approved')
      await detail.assertAuditEntry('Note added')
    })

    it('mints nothing', async () => {
      const { payload } = await getWorkItem(approval.id)
      expect(payload.accreditationId).toBeUndefined()
    })

    // AC6: logDecision entered today's UK date.
    it('records the effective date entered', async () => {
      const { payload } = await getWorkItem(approval.id)
      expect(payload.effectiveDate).toBe(isoDate(todayInUk()))
    })
  })

  describe('refusal', () => {
    before(async () => {
      await logDecision(refusal.id, 'refused')
    })

    it('tags the application "Refused" with the refusal banner', async () => {
      await workItems.openWorkItem(refusal.id)
      await detail.assertStateId('rejected-pending-contact')
      expect(await detail.stateTagText()).toBe('Refused')
      expect(await detail.pendingContactBannerTitle()).toBe(
        'Application refused'
      )
      expect(await detail.pendingContactBannerText()).toBe(
        PENDING_BANNER_SENTENCE('refused')
      )
    })

    it('offers only Reassign, Unassign and Confirm applicant contact', async () => {
      await workItems.openWorkItem(refusal.id)
      await assertOnlyPendingContactAffordances(refusal.id)
    })

    it('records the determination in Application history', async () => {
      await workItems.openWorkItem(refusal.id)
      await detail.gotoAudit()
      await detail.assertAuditEntry('Determination made: Refused')
    })

    // AC6: a refusal is not asked for a date; the submission date is recorded.
    it('records the submission date as the effective date', async () => {
      const { payload, submittedAt } = await getWorkItem(refusal.id)
      expect(payload.effectiveDate).toBe(ukIsoDateOf(submittedAt))
    })

    it('refuses an unticked confirmation and changes nothing', async () => {
      await workItems.openWorkItem(refusal.id)
      await detail.clickConfirmApplicantContact()
      await confirmContact.waitForConfirmUrl(refusal.id, TYPE_ID)
      await confirmContact.assertOnPage()
      await confirmContact.submit()
      await confirmContact.assertErrorSummary(
        'Confirm you have contacted the applicant about the decision'
      )
      await workItems.openWorkItem(refusal.id)
      await detail.assertStateId('rejected-pending-contact')
    })
  })
})
