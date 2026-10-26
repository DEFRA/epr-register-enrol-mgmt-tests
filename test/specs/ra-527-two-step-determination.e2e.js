import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import confirmContact from '../page-objects/confirm-contact.page.js'
import {
  confirmApplicantContact,
  driveToApprovedPendingContact,
  driveToRefusedPendingContact
} from '../support/re-accreditation-journey.js'
import {
  createOperatorBackedWorkItem,
  uniqueOrganisationIdGroup,
  waitForOperatorApplicationStatus
} from '../support/operator-backend-api.js'
import { getWorkItem, postDecision } from '../support/decision-api.js'

/**
 * RA-527 — the two-step determination, each step on its own, for both
 * outcomes, against the full stack (management-fe, management-be and the
 * Registration & Accreditation service backend).
 *
 *   Step 1, "Make determination": records the determination and (for an
 *   approval) mints the accreditation number, but applies nothing. The item
 *   waits in `approved-pending-contact` ("Approved") or
 *   `rejected-pending-contact` ("Refused"), and the operator still sees the
 *   status they saw before. Each step 1 tag has its final state's colour
 *   (task 010): "Approved" green like Granted, and "Refused" red like the
 *   final Refused, which it also reads the same as.
 *
 *   Step 2, "Confirm applicant contact": applies the outcome. The operator
 *   sees GRANTED / REFUSED, the item becomes Granted / Refused, and for an
 *   approval only the start date and year are stamped, the SLA clock stops
 *   and the Decision email is sent (task 007: step 2 does what the old single
 *   step did).
 *
 * Both items are operator-backed (Path B), so the operator side's own copy of
 * the status can be read back, and share one organisation-id group so the
 * worklist can be searched for exactly these two.
 *
 * NOT COVERED HERE: the step 2 retry where the operator side already shows
 * the final status while this item is still pending (task 008). The stack
 * cannot reach that state without fault injection: the status push is signed
 * as management-be, whose secret this suite does not hold. The operator
 * backend's endpoint tests cover the repeated final-status push instead.
 */

const PENDING_BANNER_SENTENCE = (outcome) =>
  `The application was ${outcome}. You now need to contact the applicant about the decision.`

const ACCREDITATION_ID_SHAPE = /^A\d{2}[ESNW][RX]\d{6}\d{4}PL$/

/**
 * While an item awaits applicant contact, the only things a regulator can do
 * are move the case between people and confirm the contact. No further
 * determination, no query and no withdraw.
 */
async function assertOnlyPendingContactAffordances(workItemId) {
  expect(await detail.hasConfirmApplicantContactCta()).toBe(true)
  expect(await detail.confirmApplicantContactCtaText()).toBe(
    'Confirm applicant contact'
  )
  expect(await detail.confirmApplicantContactHref()).toContain(
    `/work-items/re-accreditation/${workItemId}/confirm-contact`
  )
  expect(await detail.hasAssignmentControl('reassign')).toBe(true)
  expect(await detail.hasAssignmentControl('unassign')).toBe(true)
  expect(await detail.hasAssignmentControl('selfAssign')).toBe(false)

  expect(await detail.hasLogDecisionCta()).toBe(false)
  expect(await detail.hasAction('query')).toBe(false)
  expect(await detail.hasAction('sla-extend')).toBe(false)
  const withdrawActions = (await detail.availableActionIds()).filter((id) =>
    id.startsWith('withdraw')
  )
  expect(withdrawActions).toEqual([])
}

/** The `notification-sent` entries in a work item's stored history. */
function sentNotifications(workItem) {
  return workItem.auditLog.filter(
    (entry) => entry.action === 'notification-sent'
  )
}

/** No Decision email was sent, or even attempted, for this item. */
async function assertNoDecisionEmail() {
  await detail.expandAllAuditEntryDetails()
  expect(await detail.auditEntryIndex('Decision recorded')).toBe(-1)
  expect(
    (await detail.notificationSentEntriesForTemplate('Decision')).length
  ).toBe(0)
}

describe('RA-527: two-step determination', () => {
  let organisationIdGroup
  let approval
  let refusal
  let stepOneAccreditationId

  before(async () => {
    await login.login()
    organisationIdGroup = uniqueOrganisationIdGroup()
    approval = await createOperatorBackedWorkItem({ organisationIdGroup })
    refusal = await createOperatorBackedWorkItem({ organisationIdGroup })
  })

  after(async () => {
    await login.logout()
  })

  describe('approval, step 1: Make determination with Approved', () => {
    before(async () => {
      await driveToApprovedPendingContact(approval.id)
      // Captured here, not in a test, so a failing banner test cannot leave
      // every later comparison against `undefined`.
      stepOneAccreditationId = await detail.pendingContactAccreditationId()
    })

    it('tags the work item "Approved" in green, as Granted is', async () => {
      await workItems.openWorkItem(approval.id)
      await detail.assertStateId('approved-pending-contact')
      expect(await detail.stateTagText()).toBe('Approved')
      await detail.assertStateTagClass('govuk-tag--green')
    })

    it('shows the "Application approved" banner with the minted accreditation ID', async () => {
      expect(await detail.hasPendingContactBanner()).toBe(true)
      expect(await detail.pendingContactBannerTitle()).toBe(
        'Application approved'
      )
      expect(stepOneAccreditationId).toMatch(ACCREDITATION_ID_SHAPE)
      expect(await detail.pendingContactBannerText()).toBe(
        `${PENDING_BANNER_SENTENCE('approved')} Accreditation ID: ${stepOneAccreditationId}`
      )
    })

    // Task 007: the start date and year are stamped at step 2, so only the
    // Accreditation ID row shows until then.
    it('shows the Accreditation ID row but no start date or year rows', async () => {
      expect(await detail.decisionMetadataRowKeys()).toEqual([
        'Accreditation ID'
      ])
      expect(await detail.getAccreditationIdRow()).toBe(stepOneAccreditationId)
      await detail.assertNoApprovalPanel()
    })

    it('keeps the banner on every visit', async () => {
      await browser.refresh()
      await detail.assertStateId('approved-pending-contact')
      expect(await detail.hasPendingContactBanner()).toBe(true)
    })

    it('offers only Reassign, Unassign and Confirm applicant contact', async () => {
      await assertOnlyPendingContactAffordances(approval.id)
    })

    it('records the determination but pushes nothing and sends no Decision email', async () => {
      await detail.gotoAudit()
      await detail.assertAuditEntry('Determination made: Approved')
      // Duly make and start assessment pushed once each; step 1 adds none.
      await detail.waitForAuditEntryCount('status-push-sent', 2)
      await assertNoDecisionEmail()
    })

    it("leaves the operator's status as it was before the determination", async () => {
      // Assessment in progress reads as Updated on the operator side.
      await waitForOperatorApplicationStatus(approval, 'Updated')
    })
  })

  describe('refusal, step 1: Make determination with Refused', () => {
    before(async () => {
      await driveToRefusedPendingContact(refusal.id)
    })

    it('tags the work item "Refused" in red, as the final Refused is', async () => {
      await workItems.openWorkItem(refusal.id)
      await detail.assertStateId('rejected-pending-contact')
      expect(await detail.stateTagText()).toBe('Refused')
      await detail.assertStateTagClass('govuk-tag--red')
    })

    it('shows the "Application refused" banner, with no accreditation ID', async () => {
      expect(await detail.hasPendingContactBanner()).toBe(true)
      expect(await detail.pendingContactBannerTitle()).toBe(
        'Application refused'
      )
      expect(await detail.pendingContactBannerText()).toBe(
        PENDING_BANNER_SENTENCE('refused')
      )
      expect(await detail.hasPendingContactAccreditationId()).toBe(false)
    })

    it('shows no accreditation rows', async () => {
      expect(await detail.decisionMetadataRowKeys()).toEqual([])
      await detail.assertNoApprovalPanel()
    })

    it('offers only Reassign, Unassign and Confirm applicant contact', async () => {
      await assertOnlyPendingContactAffordances(refusal.id)
    })

    it('records the determination but pushes nothing', async () => {
      await detail.gotoAudit()
      await detail.assertAuditEntry('Determination made: Refused')
      await detail.waitForAuditEntryCount('status-push-sent', 2)
    })

    it("leaves the operator's status as it was before the determination", async () => {
      await waitForOperatorApplicationStatus(refusal, 'Updated')
    })
  })

  // Task 006: both pending states are on the worklist. Task 010: the step 1
  // approval has a Status option of its own ("Approved", separate from
  // "Granted"); the step 1 refusal is found under the one "Refused" option,
  // which covers both refusal states.
  describe('the worklist while both are pending', () => {
    beforeEach(async () => {
      await workItems.resetFilters()
      await workItems.searchByOrg(organisationIdGroup)
    })

    it('lists both items with no Status filter applied', async () => {
      await expect(workItems.workItemLink(approval.id)).toExist()
      await expect(workItems.workItemLink(refusal.id)).toExist()
      expect(await workItems.getWorkItemCount()).toBe(2)
    })

    it('the "Approved" Status filter returns only the approval', async () => {
      await workItems.checkStatus('approved-pending-contact')
      await workItems.applyFiltersAndWait()
      await expect(workItems.workItemLink(approval.id)).toExist()
      await expect(workItems.workItemLink(refusal.id)).not.toExist()
      expect(await workItems.getWorkItemCount()).toBe(1)
    })

    it('the "Refused" Status filter returns the pending refusal', async () => {
      await workItems.checkStatus('rejected')
      await workItems.applyFiltersAndWait()
      await expect(workItems.workItemLink(refusal.id)).toExist()
      await expect(workItems.workItemLink(approval.id)).not.toExist()
      expect(await workItems.getWorkItemCount()).toBe(1)
    })

    it('the "Granted" Status filter returns neither', async () => {
      await workItems.checkStatus('approved')
      await workItems.applyFiltersAndWait()
      expect(await workItems.getWorkItemCount()).toBe(0)
    })

    it('offers one Refused option, with Approved and Granted separate', async () => {
      expect(await workItems.statusOptionValues()).toEqual([
        'submitted',
        'duly-made',
        'updated',
        'awaiting-decision',
        'queried',
        'approved-pending-contact',
        'approved',
        'rejected',
        'withdrawn'
      ])
    })
  })

  describe('the Confirm applicant contact page', () => {
    beforeEach(async () => {
      await workItems.openWorkItem(approval.id)
      await detail.clickConfirmApplicantContact()
      await confirmContact.assertOnPage()
    })

    it('refuses an unticked box with an error summary and an inline error', async () => {
      await confirmContact.submit()
      await confirmContact.assertErrorSummary(
        'Confirm you have contacted the applicant about the decision'
      )
      await confirmContact.waitForConfirmUrl(approval.id)
      expect(await confirmContact.inlineErrorText()).toContain(
        'Confirm you have contacted the applicant about the decision'
      )

      await workItems.openWorkItem(approval.id)
      await detail.assertStateId('approved-pending-contact')
    })

    it('Cancel returns to the application summary with nothing changed', async () => {
      await confirmContact.cancel()
      await confirmContact.waitForDetailUrl(approval.id, { timeout: 10000 })
      await detail.assertStateId('approved-pending-contact')
      await detail.assertNoFlashBanner()
      expect(await detail.hasPendingContactBanner()).toBe(true)
      expect(await detail.pendingContactAccreditationId()).toBe(
        stepOneAccreditationId
      )

      await detail.gotoAudit()
      expect(
        (await detail.auditEntriesForAction('status-push-sent')).length
      ).toBe(2)
      expect(await detail.auditEntryIndex('Applicant contacted')).toBe(-1)
      await waitForOperatorApplicationStatus(approval, 'Updated')
    })
  })

  describe('approval, step 2: Confirm applicant contact', () => {
    before(async () => {
      // Leaves the browser on the detail page, one-time banner and all.
      await confirmApplicantContact(approval.id)
    })

    it('makes the work item "Granted" with a one-time "accreditation is granted" banner', async () => {
      await detail.assertState('Granted')
      await detail.assertFlashBanner()
      const banner = await detail.flashBannerText()
      expect(banner).toContain('Applicant contacted')
      expect(banner).toContain(
        'The applicant has been contacted and accreditation is granted.'
      )
      expect(await detail.hasPendingContactBanner()).toBe(false)
    })

    it('keeps the step 1 accreditation ID and adds the start date and year rows', async () => {
      expect(await detail.decisionMetadataRowKeys()).toEqual([
        'Accreditation ID',
        'Accreditation start date',
        'Accreditation year'
      ])
      expect(await detail.getAccreditationIdRow()).toBe(stepOneAccreditationId)
      await detail.assertApprovalPanelVisible()
      expect(await detail.getAccreditationId()).toBe(stepOneAccreditationId)
      expect(await detail.getAccreditationStartDate()).toMatch(
        /^\d{1,2} [A-Z][a-z]+ \d{4}$/
      )
      expect(await detail.getAccreditationYear()).toMatch(/^\d{4}$/)
    })

    it('shows the banner only once', async () => {
      await browser.refresh()
      await detail.assertState('Granted')
      await detail.assertNoFlashBanner()
    })

    it('tells the operator: GRANTED', async () => {
      // Approved on the operator side, which the operator sees as GRANTED.
      await waitForOperatorApplicationStatus(approval, 'Approved')
    })

    it('sends the Decision email now, once', async () => {
      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()
      await detail.assertAuditEntry('Applicant contacted')
      await detail.assertAuditEntry('Decision recorded: approved email sent')
      expect(
        (await detail.notificationSentEntriesForTemplate('Decision')).length
      ).toBe(1)
      await detail.waitForAuditEntryCount('status-push-sent', 3)
      // Unlike a refusal, an approval stops the SLA clock at step 2.
      expect(
        (await detail.auditEntriesForAction('sla-clock-stopped')).length
      ).toBe(1)
    })
  })

  describe('refusal, step 2: Confirm applicant contact', () => {
    let notificationsBeforeStepTwo

    before(async () => {
      notificationsBeforeStepTwo = sentNotifications(
        await getWorkItem(refusal.id)
      ).length
      await confirmApplicantContact(refusal.id)
    })

    it('makes the work item "Refused" with a one-time "accreditation is refused" banner', async () => {
      await detail.assertState('Refused')
      await detail.assertFlashBanner()
      const banner = await detail.flashBannerText()
      expect(banner).toContain('Applicant contacted')
      expect(banner).toContain(
        'The applicant has been contacted and accreditation is refused.'
      )
      expect(await detail.hasPendingContactBanner()).toBe(false)
      expect(await detail.decisionMetadataRowKeys()).toEqual([])
    })

    it('shows the banner only once', async () => {
      await browser.refresh()
      await detail.assertState('Refused')
      await detail.assertNoFlashBanner()
    })

    it('tells the operator: REFUSED', async () => {
      // Rejected on the operator side, which the operator sees as REFUSED.
      await waitForOperatorApplicationStatus(refusal, 'Rejected')
    })

    // Task 007: as the old single-step refuse did. Applicant contacted is
    // recorded, the SLA clock keeps running and no email is sent.
    it('records "Applicant contacted", leaves the SLA clock running and sends no email', async () => {
      await detail.gotoAudit()
      await detail.assertAuditEntry('Applicant contacted')
      expect(
        (await detail.auditEntriesForAction('sla-clock-stopped')).length
      ).toBe(0)
      await assertNoDecisionEmail()
      // No email of any kind went with step 2.
      expect(sentNotifications(await getWorkItem(refusal.id)).length).toBe(
        notificationsBeforeStepTwo
      )
    })
  })

  // Task 010: the same "Refused" option finds the refusal once it is final,
  // and the approval moves from "Approved" to "Granted".
  describe('the worklist once both are final', () => {
    beforeEach(async () => {
      await workItems.resetFilters()
      await workItems.searchByOrg(organisationIdGroup)
    })

    it('the "Refused" Status filter returns the final refusal', async () => {
      await workItems.checkStatus('rejected')
      await workItems.applyFiltersAndWait()
      await expect(workItems.workItemLink(refusal.id)).toExist()
      await expect(workItems.workItemLink(approval.id)).not.toExist()
      expect(await workItems.getWorkItemCount()).toBe(1)
    })

    it('the "Granted" Status filter returns the approval', async () => {
      await workItems.checkStatus('approved')
      await workItems.applyFiltersAndWait()
      await expect(workItems.workItemLink(approval.id)).toExist()
      expect(await workItems.getWorkItemCount()).toBe(1)
    })

    it('the "Approved" Status filter returns neither', async () => {
      await workItems.checkStatus('approved-pending-contact')
      await workItems.applyFiltersAndWait()
      expect(await workItems.getWorkItemCount()).toBe(0)
    })
  })

  // Task 007 (as on main): the UI offers no further determination on a final
  // item, so the endpoint is called directly, as a double submit or a stale
  // tab would.
  describe('Make determination again on a final application', () => {
    // A final state id is also the outcome that reached it ('approved',
    // 'rejected'), so `stateId` doubles as the "same outcome" to replay.
    const cases = [
      {
        name: 'Granted',
        item: () => approval,
        stateId: 'approved',
        other: 'rejected'
      },
      {
        name: 'Refused',
        item: () => refusal,
        stateId: 'rejected',
        other: 'approved'
      }
    ]

    for (const { name, item, stateId, other } of cases) {
      it(`${name}: the same outcome is a 200 that changes nothing`, async () => {
        const stored = await getWorkItem(item().id)
        expect(stored.stateId).toBe(stateId)

        const replay = await postDecision(item().id, stateId)
        expect(replay.status).toBe(200)
        expect(replay.headers.get('x-idempotent-replay')).toBe('true')
        expect(replay.body.stateId).toBe(stateId)

        const reread = await getWorkItem(item().id)
        expect(reread.stateId).toBe(stateId)
        expect(reread.lastModifiedAt).toBe(stored.lastModifiedAt)
        expect(reread.payload.accreditationId).toBe(
          stored.payload.accreditationId
        )
        // Nothing written: no audit entry, so no new email either.
        expect(reread.auditLog.length).toBe(stored.auditLog.length)
      })

      it(`${name}: the other outcome is a 409 that changes nothing`, async () => {
        const stored = await getWorkItem(item().id)

        const conflict = await postDecision(item().id, other)
        expect(conflict.status).toBe(409)

        const reread = await getWorkItem(item().id)
        expect(reread.stateId).toBe(stateId)
        expect(reread.lastModifiedAt).toBe(stored.lastModifiedAt)
        expect(reread.auditLog.length).toBe(stored.auditLog.length)
      })
    }

    it('Granted: still one Decision email and the step 1 accreditation ID', async () => {
      expect((await getWorkItem(approval.id)).payload.accreditationId).toBe(
        stepOneAccreditationId
      )
      await workItems.openWorkItem(approval.id)
      await detail.assertState('Granted')
      expect(await detail.getAccreditationId()).toBe(stepOneAccreditationId)
      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()
      expect(
        (await detail.notificationSentEntriesForTemplate('Decision')).length
      ).toBe(1)
    })
  })
})
