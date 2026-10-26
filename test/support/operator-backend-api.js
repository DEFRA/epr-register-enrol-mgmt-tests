/**
 * RA-000. Path B: work items the Registration & Accreditation service
 * backend (the operator journey backend) knows about.
 *
 * A decision (approve / refuse) is pushed by management-be to the real
 * Registration & Accreditation service backend, which only accepts it for an
 * application it owns. So every spec that takes a decision, or checks the
 * status that backend was told about (RA-368), creates its item the way a
 * real operator does: it builds an accreditation application in that backend
 * and submits it, and the backend creates the case-management work item
 * itself. Both systems then know the item.
 *
 * The organisation id starts with `e2e-`, which marks it as a test
 * organisation: the backend answers its ReEx lookups from its stub (named
 * `E2E Organisation <organisationId>`, in England), so the run never depends
 * on real ReEx data. Every email is GOV.UK Notify's simulated
 * delivered address, so no real email is sent.
 *
 * Operator-side transitions for these items (withdraw, resubmit) go through
 * that backend's own endpoints, never straight to management-be, so the two
 * systems stay consistent.
 */

import { randomBytes } from 'node:crypto'
import { browser } from '@wdio/globals'

import {
  caseManagementPushRequest,
  expectStatus,
  operatorBackendRequest
} from './backend-api.js'

export const SIMULATED_DELIVERED_EMAIL =
  'simulate-delivered@notifications.service.gov.uk'

const APPLICATIONS = '/api/v1/accreditation-applications'

/**
 * Plastic, deliberately: the stub supplies no glass recycling process, which
 * approval's accreditation-number generation needs for glass.
 */
const MATERIAL = 'Plastic'

const hex = () => randomBytes(6).toString('hex')

function applicationPath(organisationId, applicationId, suffix = '') {
  return `${APPLICATIONS}/${encodeURIComponent(organisationId)}/${encodeURIComponent(applicationId)}${suffix}`
}

/**
 * A shared organisation-id prefix for a SET of Path B items, e.g.
 * `e2e-3f9a1c2e4b5d-`. The work item's organisation name embeds the
 * organisation id, so searching the worklist by this prefix finds exactly the
 * items created with it, the same way `uniqueOrganisationName` tokens scope a
 * set of case-management-only items.
 */
export function uniqueOrganisationIdGroup() {
  return `e2e-${hex()}-`
}

/** Read the application back from that backend, e.g. its status after a decision. */
export async function getOperatorApplication(organisationId, applicationId) {
  const result = await operatorBackendRequest(
    'GET',
    applicationPath(organisationId, applicationId)
  )
  return expectStatus(result, 200, `GET R&A application ${applicationId}`).body
}

/**
 * Seed, complete and submit a reprocessor application in the Registration & Accreditation
 * service backend, and return
 * the case-management work item it created for it:
 *
 *   { id, organisationName, operatorOrganisationId, operatorApplicationId }
 *
 * `id` is the case-management work item id. `organisationName` is what the
 * work item displays and is unique to this item, because the organisation id
 * it is derived from is. Pass `organisationIdGroup` (from
 * `uniqueOrganisationIdGroup`) to create a set of items a spec can search for
 * together.
 */
export async function createOperatorBackedWorkItem({
  organisationIdGroup = 'e2e-',
  year = new Date().getUTCFullYear()
} = {}) {
  if (!organisationIdGroup.startsWith('e2e-')) {
    throw new Error(
      `organisationIdGroup must start "e2e-" (a test organisation), got "${organisationIdGroup}"`
    )
  }
  const token = hex()
  const operatorOrganisationId = `${organisationIdGroup}${token}`
  const registrationId = `e2e-reg-${token}`

  const seeded = expectStatus(
    await operatorBackendRequest(
      'POST',
      `${APPLICATIONS}/${operatorOrganisationId}/${registrationId}/${MATERIAL}/seed`,
      { body: { year } }
    ),
    201,
    `seed R&A application for ${operatorOrganisationId}`
  ).body
  const operatorApplicationId = seeded.applicationId

  const sections = {
    prns: {
      plannedTonnageBand: 'UpTo5000',
      authorisers: [
        { fullName: 'E2E Authoriser', email: SIMULATED_DELIVERED_EMAIL }
      ]
    },
    'business-plan': {
      newInfrastructurePercent: 100,
      priceSupportPercent: 0,
      businessCollectionsPercent: 0,
      communicationsPercent: 0,
      newMarketsPercent: 0,
      newUsesPercent: 0,
      otherPercent: 0,
      newInfrastructureDetail: 'E2E new infrastructure'
    },
    // Metadata only. The backend never reads the object on submit; it forwards the
    // key to case management, so this file's download link is not usable.
    'sampling-plan': {
      files: [
        {
          fileId: `e2e-file-${token}`,
          filename: 'sampling-plan.pdf',
          contentType: 'application/pdf',
          uploadedByUserId: 'e2e-tests',
          scanStatus: 'Clean',
          documentType: 'SamplingPlan',
          s3Key: `e2e/${token}/sampling-plan.pdf`,
          s3Bucket: 'sampling-plans'
        }
      ]
    }
  }
  for (const [section, body] of Object.entries(sections)) {
    expectStatus(
      await operatorBackendRequest(
        'PATCH',
        applicationPath(
          operatorOrganisationId,
          operatorApplicationId,
          `/${section}`
        ),
        { body: { ...body, sectionStatus: 'Completed' } }
      ),
      200,
      `complete R&A ${section} for ${operatorApplicationId}`
    )
  }

  expectStatus(
    await operatorBackendRequest(
      'POST',
      applicationPath(operatorOrganisationId, operatorApplicationId, '/submit'),
      {
        body: {
          fullName: 'E2E Submitter',
          jobTitle: 'Tester',
          email: SIMULATED_DELIVERED_EMAIL
        }
      }
    ),
    200,
    `submit R&A application ${operatorApplicationId}`
  )

  const submitted = await getOperatorApplication(
    operatorOrganisationId,
    operatorApplicationId
  )
  if (!submitted.caseManagementWorkItemId) {
    throw new Error(
      `R&A application ${operatorApplicationId} was submitted but has no caseManagementWorkItemId`
    )
  }
  return {
    id: submitted.caseManagementWorkItemId,
    organisationName: submitted.organisationName,
    operatorOrganisationId,
    operatorApplicationId
  }
}

/**
 * Wait until that backend's copy of the application reads `applicationStatus`, the
 * status case management pushed to it. The push happens inside the case
 * management request, but reading it straight after the browser lands is a
 * separate request, so poll rather than assume ordering.
 */
export async function waitForOperatorApplicationStatus(
  { operatorOrganisationId, operatorApplicationId },
  applicationStatus
) {
  let last
  await browser.waitUntil(
    async () => {
      last = await getOperatorApplication(
        operatorOrganisationId,
        operatorApplicationId
      )
      return last.applicationStatus === applicationStatus
    },
    {
      timeout: 15_000,
      interval: 500,
      timeoutMsg: `R&A application ${operatorApplicationId} never reached ${applicationStatus}`
    }
  )
  return last
}

/**
 * Withdraw a Path B item as its operator, through that backend, which withdraws the
 * case-management item first and then records the withdrawal itself.
 */
export async function withdrawOperatorApplication(
  { operatorOrganisationId, operatorApplicationId },
  reason = 'Withdrawn by the operator (test fixture)'
) {
  return expectStatus(
    await operatorBackendRequest(
      'POST',
      applicationPath(
        operatorOrganisationId,
        operatorApplicationId,
        '/withdraw'
      ),
      {
        body: {
          reason,
          fullName: 'E2E Submitter',
          email: SIMULATED_DELIVERED_EMAIL
        }
      }
    ),
    200,
    `withdraw R&A application ${operatorApplicationId}`
  ).body
}

/**
 * RA-690. Ask the operator backend for the application's accreditation
 * number AS management-be, exactly as approval's step 1 does, so a spec can
 * replay that call (e.g. a retry after a lost reply). Sends no body: the
 * backend derives the reference from the application itself. Only where
 * `isCaseManagementPushEnabled()` (see backend-api.js). Returns the raw
 * `{ status, headers, body }`.
 */
export function requestAccreditationNumberAsCaseManagement({
  operatorOrganisationId,
  operatorApplicationId
}) {
  return caseManagementPushRequest(
    'POST',
    applicationPath(
      operatorOrganisationId,
      operatorApplicationId,
      '/accreditation-number'
    )
  )
}

/**
 * RA-527. Step 2's status push for each outcome, as management-be sends it
 * on "Confirm applicant contact": from the pending state to the final one.
 */
const CONFIRM_CONTACT_PUSH = {
  approved: {
    fromStateId: 'approved-pending-contact',
    toStateId: 'approved',
    toStateDisplayName: 'Granted',
    actionId: 'confirm-contact-approved'
  },
  rejected: {
    fromStateId: 'rejected-pending-contact',
    toStateId: 'rejected',
    toStateDisplayName: 'Refused',
    actionId: 'confirm-contact-rejected'
  }
}

/**
 * RA-527. Send the operator backend step 2's final-status push for
 * `outcome` (`'approved'` or `'rejected'`) AS management-be, for the Path B
 * item whose case-management work item is `workItemId`. Only where
 * `isCaseManagementPushEnabled()` (see backend-api.js).
 *
 * This is what management-be has done when step 2's push was delivered but
 * its own write then failed or the reply was lost: the operator side holds
 * the final status while the work item is still pending. Returns the raw
 * `{ status, headers, body }`, because a 409 is an answer the caller may
 * assert on.
 */
export function pushConfirmContactStatusAsCaseManagement(
  workItemId,
  outcome,
  { occurredAt = new Date() } = {}
) {
  const push = CONFIRM_CONTACT_PUSH[outcome]
  if (!push) {
    throw new Error(
      `Unknown outcome "${outcome}" (expected "approved" or "rejected")`
    )
  }
  return caseManagementPushRequest(
    'POST',
    `${APPLICATIONS}/case-management/${encodeURIComponent(workItemId)}/status`,
    {
      body: {
        ...push,
        actionDisplayName: 'Confirm applicant contact',
        occurredAt: occurredAt.toISOString()
      }
    }
  )
}
