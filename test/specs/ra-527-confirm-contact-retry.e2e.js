import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  confirmApplicantContact,
  driveToApprovedPendingContact,
  driveToRefusedPendingContact
} from '../support/re-accreditation-journey.js'
import {
  createOperatorBackedWorkItem,
  getOperatorApplication,
  pushConfirmContactStatusAsCaseManagement,
  uniqueOrganisationIdGroup,
  waitForOperatorApplicationStatus
} from '../support/operator-backend-api.js'
import {
  expectStatus,
  isCaseManagementPushEnabled
} from '../support/backend-api.js'
import { getWorkItem } from '../support/decision-api.js'

/**
 * RA-527 task 008. "Confirm applicant contact" retried after its final-status
 * push was already delivered.
 *
 * Step 2 pushes the final status to the Registration & Accreditation service
 * backend first, then writes the work item. If the push is delivered but the
 * write then fails, or management-be never hears the reply, the operator side
 * already holds Approved / Rejected while the work item is still pending
 * contact. The regulator retries by confirming again, and management-be
 * pushes the same final status again with a newer OccurredAt.
 *
 * Until task 008 that backend answered 409 to the repeat ("already Approved,
 * Rejected or Withdrawn"), management-be abandoned the step with a 500, and
 * every retry failed the same way: the item could only be completed by hand.
 * It now answers 200 with no change, so the retry goes on to make the write.
 *
 * The fault is set up rather than provoked: after step 1, the suite sends
 * the operator backend step 2's push itself, signed as management-be. That
 * is exactly the state a delivered push plus a failed write leaves. The
 * regulator then confirms in the UI as normal, which is the retry.
 *
 * Runs only where the suite may sign as management-be
 * (CASE_MANAGEMENT_PUSH_ENABLED, see support/backend-api.js): the compose
 * stack and a local stack. Skipped on CDP, where that secret is
 * management-be's alone.
 */

const describeIfCaseManagementPush = isCaseManagementPushEnabled()
  ? describe
  : describe.skip

/**
 * The backend's ordering watermark as a Date. It is serialized as UTC; a
 * value with no zone designator is read as UTC too, never as the runner's
 * local time.
 */
function watermarkOf(application) {
  const value = application.caseManagementStatusUpdatedAt
  expect(value).toBeTruthy()
  return new Date(/([zZ]|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`)
}

describeIfCaseManagementPush(
  'RA-527: Confirm applicant contact retried after its push was delivered',
  () => {
    let organisationIdGroup
    const items = {}

    before(async () => {
      await login.login()
      organisationIdGroup = uniqueOrganisationIdGroup()
      items.approval = await createOperatorBackedWorkItem({
        organisationIdGroup
      })
      items.refusal = await createOperatorBackedWorkItem({
        organisationIdGroup
      })
    })

    after(async () => {
      await login.logout()
    })

    const cases = [
      {
        name: 'approval',
        item: () => items.approval,
        driveToPending: driveToApprovedPendingContact,
        outcome: 'approved',
        pendingStateId: 'approved-pending-contact',
        finalStateId: 'approved',
        finalStateLabel: 'Granted',
        operatorStatus: 'Approved',
        bannerSentence:
          'The applicant has been contacted and accreditation is granted.'
      },
      {
        name: 'refusal',
        item: () => items.refusal,
        driveToPending: driveToRefusedPendingContact,
        outcome: 'rejected',
        pendingStateId: 'rejected-pending-contact',
        finalStateId: 'rejected',
        finalStateLabel: 'Refused',
        operatorStatus: 'Rejected',
        bannerSentence:
          'The applicant has been contacted and accreditation is refused.'
      }
    ]

    for (const c of cases) {
      describe(`${c.name}: the first push landed, the write did not`, () => {
        let operatorAfterFirstPush

        before(async () => {
          await c.driveToPending(c.item().id)

          // OccurredAt just after the backend's watermark (the last push it
          // took, start assessment's), so the first push is applied and the
          // retry, stamped later by management-be's own clock, is newer still.
          // Taken from the runner's clock instead, any skew against the
          // containers could make the backend drop the retry as out of order,
          // which is a 200 too but would not reach the repeat this spec is for.
          const beforePush = await getOperatorApplication(
            c.item().operatorOrganisationId,
            c.item().operatorApplicationId
          )
          const occurredAt = new Date(watermarkOf(beforePush).getTime() + 1)

          expectStatus(
            await pushConfirmContactStatusAsCaseManagement(
              c.item().id,
              c.outcome,
              { occurredAt }
            ),
            200,
            `first confirm-contact push for ${c.item().id}`
          )
          operatorAfterFirstPush = await waitForOperatorApplicationStatus(
            c.item(),
            c.operatorStatus
          )
        })

        it(`leaves the operator at ${c.operatorStatus} while the work item still awaits contact`, async () => {
          expect(operatorAfterFirstPush.applicationStatus).toBe(
            c.operatorStatus
          )
          expect((await getWorkItem(c.item().id)).stateId).toBe(
            c.pendingStateId
          )

          await workItems.openWorkItem(c.item().id)
          await detail.assertStateId(c.pendingStateId)
          expect(await detail.hasConfirmApplicantContactCta()).toBe(true)
        })

        it(`confirming again completes the step: the work item becomes ${c.finalStateLabel}`, async () => {
          // Fails here, after a long wait for the redirect, if the backend
          // still refuses the repeat: management-be answers 500 and the item
          // stays pending.
          await confirmApplicantContact(c.item().id)

          await detail.assertState(c.finalStateLabel)
          await detail.assertFlashBanner()
          const banner = await detail.flashBannerText()
          expect(banner).toContain('Applicant contacted')
          expect(banner).toContain(c.bannerSentence)
          expect(await detail.hasPendingContactBanner()).toBe(false)
          expect((await getWorkItem(c.item().id)).stateId).toBe(c.finalStateId)
        })

        it('the repeated push changed nothing on the operator side', async () => {
          const operator = await getOperatorApplication(
            c.item().operatorOrganisationId,
            c.item().operatorApplicationId
          )
          expect(operator.applicationStatus).toBe(c.operatorStatus)
          // The repeat writes nothing, so the watermark stays where the first
          // push left it.
          expect(operator.caseManagementStatusUpdatedAt).toBe(
            operatorAfterFirstPush.caseManagementStatusUpdatedAt
          )
        })

        it('records the push as sent and no push failure', async () => {
          await detail.gotoAudit()
          await detail.assertAuditEntry('Applicant contacted')
          // Duly make and start assessment, then the retry's push.
          await detail.waitForAuditEntryCount('status-push-sent', 3)
          expect(
            (await detail.auditEntriesForAction('status-push-failed')).length
          ).toBe(0)
        })

        if (c.outcome === 'approved') {
          it('stamps the start date and year and sends the Decision email once', async () => {
            await workItems.openWorkItem(c.item().id)
            expect(await detail.decisionMetadataRowKeys()).toEqual([
              'Accreditation ID',
              'Accreditation start date',
              'Accreditation year'
            ])
            await detail.gotoAudit()
            await detail.expandAllAuditEntryDetails()
            await detail.assertAuditEntry(
              'Decision recorded: approved email sent'
            )
            expect(
              (await detail.notificationSentEntriesForTemplate('Decision'))
                .length
            ).toBe(1)
            expect(
              (await detail.auditEntriesForAction('sla-clock-stopped')).length
            ).toBe(1)
          })
        }
      })
    }

    // The 200 is only for a repeat of the status the application already
    // has. Any other final status is still refused.
    describe('a push of the other final status afterwards', () => {
      const others = [
        { name: 'Granted', item: () => items.approval, other: 'rejected' },
        { name: 'Refused', item: () => items.refusal, other: 'approved' }
      ]

      for (const { name, item, other } of others) {
        it(`${name}: is still a 409 that changes nothing`, async () => {
          const before = await getOperatorApplication(
            item().operatorOrganisationId,
            item().operatorApplicationId
          )

          const conflict = await pushConfirmContactStatusAsCaseManagement(
            item().id,
            other,
            { occurredAt: new Date(watermarkOf(before).getTime() + 1) }
          )
          expect(conflict.status).toBe(409)

          const after = await getOperatorApplication(
            item().operatorOrganisationId,
            item().operatorApplicationId
          )
          expect(after.applicationStatus).toBe(before.applicationStatus)
          expect(after.caseManagementStatusUpdatedAt).toBe(
            before.caseManagementStatusUpdatedAt
          )
        })
      }
    })
  }
)
