import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import { driveToApproved } from '../support/re-accreditation-journey.js'
import {
  createOperatorBackedWorkItem,
  regenerateRegistrationNumberAsCaseManagement,
  waitForOperatorApplicationStatus
} from '../support/operator-backend-api.js'
import { isCaseManagementPushEnabled } from '../support/backend-api.js'

/**
 * RA-690. A consecutive-year renewal keeps the operator's accreditation
 * reference with only the year changed.
 *
 * Year N is approved for a registration. The same organisation then applies
 * for N+1 on the same registration and material, and that is approved too.
 * RA-763: each year's reference is derived from the previous year's
 * accreditation number, which the seed takes from ReEx and keeps on the
 * application. The stub gives every year of a registration the same
 * accreditation sequence, and a different one from its registration's, so N+1
 * is N's reference with YY swapped, and neither comes from the registration.
 *
 * Where the suite may sign as management-be (CASE_MANAGEMENT_PUSH_ENABLED, see
 * support/backend-api.js), year N's registration number is first regenerated
 * from the backend's counter, to show that a changed registration number does
 * not change the reference. Without that, the spec still proves the renewal
 * flow and the reference continuity end to end, and the backend's own tests
 * pin which source is chosen. So unlike its siblings, this spec isn't skipped
 * without that signing; only that step is.
 *
 * A lapsed renewal (N to N+2) is not tested here: Seed cannot yet start an
 * application for a lapsed operator.
 */

/** The reference with its YY (characters 2–3) replaced by `year`'s. */
function withYear(reference, year) {
  return `${reference[0]}${String(year % 100).padStart(2, '0')}${reference.slice(3)}`
}

describe('RA-690 consecutive-year renewal keeps the accreditation reference', () => {
  const yearN = new Date().getUTCFullYear()
  let first
  let firstAccreditationReference

  it('approves year N and issues its accreditation reference', async () => {
    first = await createOperatorBackedWorkItem({ year: yearN })
    if (isCaseManagementPushEnabled()) {
      // A registration reference carries the prior year's YY, as the stub's
      // does. Must happen before approval, which reads it.
      await regenerateRegistrationNumberAsCaseManagement(first, {
        year: yearN - 1
      })
    }

    await login.login()
    await driveToApproved(first.id)
    await login.logout()

    const application = await waitForOperatorApplicationStatus(
      first,
      'Approved'
    )
    expect(application.accreditationReference).toMatch(
      /^A\d{2}[ESNW][RX]\d{6}\d{4}PL$/
    )
    // RA-763: derived from last year's accreditation number, not the
    // registration number.
    expect(application.lastYearsAccreditation?.year).toBe(yearN - 1)
    expect(application.accreditationReference).toBe(
      withYear(application.lastYearsAccreditation.accreditationNumber, yearN)
    )
    expect(application.accreditationReference).not.toBe(
      withYear(`A${application.registrationReference.slice(1)}`, yearN)
    )
    firstAccreditationReference = application.accreditationReference
  })

  it('approves year N+1 for the same registration with only YY changed', async () => {
    const second = await createOperatorBackedWorkItem({
      year: yearN + 1,
      operatorOrganisationId: first.operatorOrganisationId,
      registrationId: first.registrationId
    })

    await login.login()
    await driveToApproved(second.id)
    await login.logout()

    const application = await waitForOperatorApplicationStatus(
      second,
      'Approved'
    )
    expect(application.accreditationReference).toBe(
      withYear(firstAccreditationReference, yearN + 1)
    )
    expect(application.accreditationReference).not.toBe(
      withYear(`A${application.registrationReference.slice(1)}`, yearN + 1)
    )
  })
})
