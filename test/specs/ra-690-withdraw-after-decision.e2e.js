import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import {
  driveToApprovedPendingContact,
  driveToRefusedPendingContact
} from '../support/re-accreditation-journey.js'
import {
  createOperatorBackedWorkItem,
  getOperatorApplication,
  requestOperatorWithdrawal,
  uniqueOrganisationIdGroup
} from '../support/operator-backend-api.js'
import { getWorkItem } from '../support/decision-api.js'

/**
 * RA-690. An operator who withdraws after the regulator has made the
 * determination (step 1) is refused with a 409, and nothing changes on either
 * side, so the operator isn't sent to the service-problem page to retry
 * something that can never work. The frontend shows its existing "no longer
 * eligible" text for any 409.
 *
 * Both outcomes, because they are refused on different paths:
 *
 *   approval: step 1 stores the accreditation reference on the operator
 *   side, so the operator backend refuses up front without calling
 *   management-be.
 *
 *   refusal: no reference is stored, so the operator backend asks
 *   management-be, which has no withdraw transition out of
 *   `rejected-pending-contact` and answers 409. The operator backend passes
 *   that 409 on.
 *
 * The operator keeps the status they saw before the determination: Duly
 * made, because neither starting the case nor step 1 pushes anything (RA-527).
 */

const DECISION_MADE_MESSAGE =
  'A decision has already been made on this application, so it can no longer be withdrawn.'

const ACCREDITATION_ID_SHAPE = /^A\d{2}[ESNW][RX]\d{6}\d{4}PL$/

describe('RA-690: withdrawing after a decision is recorded', () => {
  const cases = [
    {
      name: 'approved at step 1',
      driveToStepOne: driveToApprovedPendingContact,
      stateId: 'approved-pending-contact',
      holdsReference: true
    },
    {
      name: 'refused at step 1',
      driveToStepOne: driveToRefusedPendingContact,
      stateId: 'rejected-pending-contact',
      holdsReference: false
    }
  ]

  let organisationIdGroup

  before(async () => {
    await login.login()
    organisationIdGroup = uniqueOrganisationIdGroup()
  })

  after(async () => {
    await login.logout()
  })

  for (const { name, driveToStepOne, stateId, holdsReference } of cases) {
    describe(name, () => {
      let item
      let operatorBefore
      let workItemBefore
      let withdrawal

      before(async () => {
        item = await createOperatorBackedWorkItem({ organisationIdGroup })
        await driveToStepOne(item.id)
        operatorBefore = await getOperatorApplication(
          item.operatorOrganisationId,
          item.operatorApplicationId
        )
        workItemBefore = await getWorkItem(item.id)
        withdrawal = await requestOperatorWithdrawal(item)
      })

      // Pins which refusal path this case takes (see the module doc).
      it(`${holdsReference ? 'holds' : 'holds no'} accreditation reference on the operator side`, () => {
        if (holdsReference) {
          expect(operatorBefore.accreditationReference).toMatch(
            ACCREDITATION_ID_SHAPE
          )
        } else {
          expect(operatorBefore.accreditationReference ?? null).toBeNull()
        }
      })

      it('refuses the withdraw with a 409 saying a decision has been made', () => {
        expect(withdrawal.status).toBe(409)
        expect(withdrawal.body).toBe(DECISION_MADE_MESSAGE)
      })

      it("leaves the operator's application as it was", async () => {
        const operatorAfter = await getOperatorApplication(
          item.operatorOrganisationId,
          item.operatorApplicationId
        )
        expect(operatorBefore.applicationStatus).toBe('DulyMade')
        expect(operatorAfter.applicationStatus).toBe('DulyMade')
        expect(operatorAfter.withdrawalReason ?? null).toBeNull()
        expect(operatorAfter.accreditationReference ?? null).toBe(
          operatorBefore.accreditationReference ?? null
        )
      })

      it(`leaves the work item in ${stateId}, unchanged`, async () => {
        const workItemAfter = await getWorkItem(item.id)
        expect(workItemAfter.stateId).toBe(stateId)
        expect(workItemAfter.lastModifiedAt).toBe(workItemBefore.lastModifiedAt)
        expect(workItemAfter.auditLog.length).toBe(
          workItemBefore.auditLog.length
        )
      })
    })
  }
})
