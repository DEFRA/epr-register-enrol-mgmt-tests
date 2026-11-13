import { randomInt } from 'node:crypto'
import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import {
  isOperatorBackendSubmitEnabled,
  operatorBackendSubmitRequest
} from '../support/backend-api.js'
import { getWorkItem } from '../support/decision-api.js'
import { createOperatorBackedWorkItem } from '../support/operator-backend-api.js'
import { buildWorkItemPayload } from '../support/work-item-api.js'

/**
 * RA-000 — never submit or show a payment reference or application reference
 * without the real organisation number.
 *
 * When the operator backend's ReEx org-number lookup failed at submit, the
 * payment reference it sent case management could end in `/null`, and
 * management-be built the application reference from the last 5 characters
 * of ReEx's internal ObjectId (`operatorOrganisationId`) instead of the
 * organisation number. The regulator could not match the payment, and
 * nothing said so.
 *
 * Now the operator backend sends `operatorOrgNumber` and the
 * `paymentReference` it built from it, and management-be refuses a
 * submission from the operator backend that lacks either: 400 ProblemDetails,
 * no work item, an Error log. Work items created any other way (management-fe's
 * "Create work item" form, this suite's own API items) keep their old path;
 * `ra-196-application-ref.e2e.js`, `ra-219-server-side-application-reference.e2e.js`
 * and `create-work-item-fields.e2e.js` cover the form.
 *
 * 1. A real operator submission (through the operator backend, so it is
 *    that backend's payload, not one this suite wrote): the case header
 *    shows the organisation number, the application reference carries it
 *    as its organisation segment, and the duly-making page shows the exact
 *    payment reference the operator was given. Runs everywhere.
 *
 * 2. management-be's refusal. Only a submission signed as the operator
 *    backend is held to that contract, so this part plays the operator
 *    backend, which only the compose and local stacks allow (see
 *    `operatorBackendSubmitRequest`); it is skipped on CDP. management-be's
 *    Error log is not visible from here; its unit tests assert it.
 */

/** England, which the stub gives every `e2e-` organisation. */
const ENGLAND_AGENCY = 'EA'

/** Plastic, the material both kinds of item here are submitted with. */
const PLASTIC_PREFIX = 'PL'

/**
 * The operator backend's England reprocessor payment reference
 * (`buildPaymentReference` in epr-register-enrol-frontend, now built by
 * epr-register-enrol-backend at submit).
 */
const englandReprocessorPaymentReference = (orgNumber) =>
  `PR/PK/REP/${orgNumber}`

/**
 * management-be's application reference for an England plastic item:
 * `AP` + 2-digit accreditation year + agency + the 6-digit organisation number + the last
 * 3 characters of the site postcode + the material prefix. The organisation
 * segment is pinned to the org number, so the ObjectId tail
 * (`operatorOrganisationId`'s last 5 characters) it replaced cannot match.
 *
 * Exact, except for the one character management-be appends when a
 * reference collides with an existing one (`DisambiguatorChar`). The stub
 * hands `e2e-` organisations numbers from a range of 100,000, so on a
 * long-lived environment two runs can share a number, year and postcode
 * suffix; that suffix is the only variation allowed.
 */
function applicationReferencePattern({
  accreditationYear,
  orgNumber,
  siteAddressPostcode
}) {
  if (!Number.isInteger(accreditationYear) || !siteAddressPostcode) {
    throw new Error(
      'The work item payload has no accreditationYear or siteAddressPostcode'
    )
  }
  const yearSegment = String(accreditationYear % 100).padStart(2, '0')
  const postcodeSuffix = siteAddressPostcode
    .replaceAll(' ', '')
    .slice(-3)
    .toUpperCase()
  return new RegExp(
    `^AP${yearSegment}${ENGLAND_AGENCY}${orgNumber}${postcodeSuffix}${PLASTIC_PREFIX}\\d?$`
  )
}

describe('RA-000 — a real operator submission carries the organisation number', () => {
  let item
  let storedPayload

  before(async () => {
    item = await createOperatorBackedWorkItem()
    storedPayload = (await getWorkItem(item.id)).payload
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  it('submits the organisation number and the payment reference built from it', () => {
    // The stub's number for an `e2e-` organisation: 900000-999999.
    expect(Number.isInteger(item.orgNumber)).toBe(true)
    expect(item.orgNumber).toBeGreaterThanOrEqual(900000)
    expect(item.orgNumber).toBeLessThanOrEqual(999999)
    expect(item.paymentReference).toBe(
      englandReprocessorPaymentReference(item.orgNumber)
    )

    // What case management stored is what the operator backend sent, not a
    // reference it made up (it used to copy the application reference in).
    expect(storedPayload.operatorOrgNumber).toBe(item.orgNumber)
    expect(storedPayload.paymentReference).toBe(item.paymentReference)
  })

  it('shows the organisation number in the case header', async () => {
    await workItems.openWorkItem(item.id)
    await expect(detail.caseHeaderField('orgId')).toHaveText(
      String(item.orgNumber)
    )
  })

  it('builds the application reference from the organisation number, not the ObjectId tail', async () => {
    await workItems.openWorkItem(item.id)
    const applicationReference = await detail.getCaption()

    expect(applicationReference).toBe(storedPayload.applicationReference)
    expect(applicationReference).toMatch(
      applicationReferencePattern({
        accreditationYear: storedPayload.accreditationYear,
        orgNumber: item.orgNumber,
        siteAddressPostcode: storedPayload.siteAddressPostcode
      })
    )
    expect(applicationReference.toLowerCase()).not.toContain('null')
  })

  it('shows the exact payment reference on the duly-making page', async () => {
    await dulyMaking.gotoFor(item.id)
    await dulyMaking.assertOnPage()

    const paymentReference = await dulyMaking.paymentReferenceText()
    expect(paymentReference).toBe(
      englandReprocessorPaymentReference(item.orgNumber)
    )
    expect(paymentReference).toBe(item.paymentReference)
    expect(paymentReference.toLowerCase()).not.toContain('null')
  })
})

const ORG_NUMBER_DETAIL =
  'A submission from the operator backend must include operatorOrgNumber as a whole number from 0 to 999999.'
const PAYMENT_REFERENCE_DETAIL =
  'A submission from the operator backend must include a non-blank paymentReference string.'

/**
 * Each case breaks a valid operator-backend payload one way. `orgNumber:
 * null` and the string form are what a failed lookup and a careless
 * serialiser send; `paymentReference` blank is what an unset reference
 * template produces.
 */
const REFUSALS = [
  {
    name: 'no operatorOrgNumber',
    breakPayload: (payload) => delete payload.operatorOrgNumber,
    detail: ORG_NUMBER_DETAIL
  },
  {
    name: 'a null operatorOrgNumber',
    breakPayload: (payload) => (payload.operatorOrgNumber = null),
    detail: ORG_NUMBER_DETAIL
  },
  {
    name: 'operatorOrgNumber as a string',
    breakPayload: (payload) =>
      (payload.operatorOrgNumber = String(payload.operatorOrgNumber)),
    detail: ORG_NUMBER_DETAIL
  },
  {
    name: 'operatorOrgNumber above 999999',
    breakPayload: (payload) => (payload.operatorOrgNumber = 1000000),
    detail: ORG_NUMBER_DETAIL
  },
  {
    name: 'no paymentReference',
    breakPayload: (payload) => delete payload.paymentReference,
    detail: PAYMENT_REFERENCE_DETAIL
  },
  {
    name: 'a blank paymentReference',
    breakPayload: (payload) => (payload.paymentReference = '   '),
    detail: PAYMENT_REFERENCE_DETAIL
  },
  {
    name: 'neither',
    breakPayload: (payload) => {
      delete payload.operatorOrgNumber
      delete payload.paymentReference
    },
    detail: `${ORG_NUMBER_DETAIL} ${PAYMENT_REFERENCE_DETAIL}`
  }
]

/** A payload the operator backend would send for an England reprocessor. */
function operatorBackendPayload() {
  const orgNumber = 900000 + randomInt(100000)
  return buildWorkItemPayload({
    organisationNamePrefix: 'RA-000 Org Number',
    fields: {
      operatorOrgNumber: orgNumber,
      paymentReference: englandReprocessorPaymentReference(orgNumber)
    }
  })
}

const submission = (payload) => ({
  typeId: 're-accreditation',
  // What epr-register-enrol-backend's HttpCaseWorkingApiAdapter sends.
  source: 'operator-fe',
  payload
})

const describeIfOperatorBackendSubmit = isOperatorBackendSubmitEnabled()
  ? describe
  : describe.skip

describeIfOperatorBackendSubmit(
  'RA-000 — management-be refuses an operator-backend submission without the organisation number or payment reference',
  () => {
    for (const { name, breakPayload, detail: expectedDetail } of REFUSALS) {
      it(`refuses ${name} with a 400 and stores no work item`, async () => {
        const payload = operatorBackendPayload()
        const broken = structuredClone(payload)
        breakPayload(broken)

        const refused = await operatorBackendSubmitRequest(submission(broken))
        expect(refused.status).toBe(400)
        expect(refused.body).toMatchObject({
          status: 400,
          title: 'Invalid request',
          detail: expectedDetail
        })

        // management-be treats a repeated operatorApplicationId as a replay
        // and answers with the stored item and `X-Idempotent-Replay: true`.
        // The same application submitted correctly is therefore new only if
        // the refused submission stored nothing.
        const accepted = await operatorBackendSubmitRequest(submission(payload))
        expect(accepted.status).toBe(201)
        expect(accepted.headers.get('x-idempotent-replay')).toBeNull()

        // And a correct submission keeps both values as sent.
        expect(accepted.body.payload.operatorOrgNumber).toBe(
          payload.operatorOrgNumber
        )
        expect(accepted.body.payload.paymentReference).toBe(
          payload.paymentReference
        )
        expect(accepted.body.payload.applicationReference).toMatch(
          applicationReferencePattern({
            accreditationYear: payload.accreditationYear,
            orgNumber: payload.operatorOrgNumber,
            siteAddressPostcode: payload.siteAddressPostcode
          })
        )
      })
    }
  }
)
