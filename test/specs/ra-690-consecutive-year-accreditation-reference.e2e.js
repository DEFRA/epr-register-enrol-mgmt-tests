import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import { driveToApproved } from '../support/re-accreditation-journey.js'
import {
  createOperatorBackedWorkItem,
  waitForOperatorApplicationStatus
} from '../support/operator-backend-api.js'
import {
  derivedFromRegistration,
  withYear
} from '../support/accreditation-reference.js'

/**
 * RA-690. A consecutive-year renewal keeps the operator's accreditation
 * reference with only the year changed.
 *
 * Year N is approved for a registration. The same organisation then applies
 * for N+1 on the same registration and material, and that is approved too.
 *
 * RA-763: year N has no earlier accreditation held in the operator backend,
 * so its reference is derived from last year's accreditation number, which
 * the seed keeps from ReEx. Year N+1's comes from year N's accreditation,
 * which the operator backend now holds: the same reference with YY swapped.
 * The stub gives a registration's accreditation a different sequence from the
 * registration itself, so neither reference can come from the registration
 * number. It also gives each year's accreditation its own sequence, so N+1's
 * last-year number from ReEx differs from the one held for N, and the spec can
 * tell that the held accreditation came first.
 *
 * A lapsed renewal (N to N+2) is not tested here: Seed cannot yet start an
 * application for a lapsed operator.
 */

describe('RA-690 consecutive-year renewal keeps the accreditation reference', () => {
  const yearN = new Date().getUTCFullYear()
  let first
  let firstAccreditationReference

  it('approves year N and issues its accreditation reference', async () => {
    first = await createOperatorBackedWorkItem({ year: yearN })

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
    expect(application.lastYearsAccreditationNumber?.year).toBe(yearN - 1)
    expect(application.accreditationReference).toBe(
      withYear(
        application.lastYearsAccreditationNumber.accreditationNumber,
        yearN
      )
    )
    expect(application.accreditationReference).not.toBe(
      derivedFromRegistration(application.registrationReference, yearN)
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
    // Last year's number from ReEx is not the one held for year N, so the two
    // sources give different references and the assertions below say which.
    const lastYears = application.lastYearsAccreditationNumber
    expect(lastYears?.year).toBe(yearN)
    expect(lastYears.accreditationNumber).not.toBe(firstAccreditationReference)
    expect(application.accreditationReference).toBe(
      withYear(firstAccreditationReference, yearN + 1)
    )
    expect(application.accreditationReference).not.toBe(
      withYear(lastYears.accreditationNumber, yearN + 1)
    )
    expect(application.accreditationReference).not.toBe(
      derivedFromRegistration(application.registrationReference, yearN + 1)
    )
  })
})
