/**
 * RA-739. Add-ORS (`add-overseas-site`) submissions posted straight to
 * management-be's `POST /work-items`, the call the operator backend makes when
 * an operator submits a request to add overseas reprocessing sites.
 * management-be splits the request into one work item per site.
 *
 * Every submission is unique to its run: a fresh `operatorRequestId` (a
 * repeated one is a replay), a `uniqueOrganisationName` and an `e2e-`
 * organisation id, which marks a test organisation.
 */

import { randomBytes, randomInt } from 'node:crypto'

import {
  CASEWORKER_USER,
  expectStatus,
  managementBeRequest
} from './backend-api.js'
import { uniqueOrganisationName } from './unique-name.js'

const TYPE_ID = 'add-overseas-site'

const hex = () => randomBytes(6).toString('hex')

/**
 * Build, without sending, an add-ORS request with `siteCount` sites:
 *
 *   { payload, organisationName, operatorOrgNumber, sites }
 *
 * `payload` is what `postAddOverseasSiteRequest` sends; `sites` is its
 * `sites[]`.
 */
export function buildAddOverseasSiteRequest({
  organisationNamePrefix,
  siteCount
}) {
  const token = hex()
  const organisationName = uniqueOrganisationName(organisationNamePrefix)
  const operatorOrgNumber = randomInt(100000, 1000000)
  const sites = Array.from({ length: siteCount }, (_, index) => ({
    siteId: `e2e-site-${token}-${index + 1}`,
    orsId: String(index + 1).padStart(3, '0'),
    siteName: `${organisationName} site ${index + 1}`,
    country: 'France'
  }))
  const payload = {
    operatorRequestId: `e2e-request-${token}`,
    changeType: TYPE_ID,
    operatorOrganisationId: `e2e-${token}`,
    organisationName,
    operatorOrgNumber,
    material: 'Plastic',
    accreditationYear: new Date().getUTCFullYear(),
    wasteProcessingType: 'Exporter',
    chargePence: 100000 * siteCount,
    paymentReference: `PR/PK/EXP/${operatorOrgNumber}`,
    sites
  }
  return { payload, organisationName, operatorOrgNumber, sites }
}

/**
 * Post `payload` to management-be as an add-ORS submission and return the raw
 * `{ status, headers, body }`, whatever the status.
 */
export function postAddOverseasSiteRequest(payload) {
  return managementBeRequest('POST', '/work-items', {
    body: { typeId: TYPE_ID, source: 'mgmt-tests', payload }
  })
}

/**
 * Submit an add-ORS request with `siteCount` sites and return
 *
 *   { submissionReference, workItems: [{ siteId, id, applicationReference }],
 *     organisationName, operatorOrgNumber, sites, payload }
 *
 * `workItems` is management-be's response, in site order; `sites` is what
 * was submitted, in the same order.
 */
export async function submitAddOverseasSiteRequest({
  organisationNamePrefix,
  siteCount
}) {
  const request = buildAddOverseasSiteRequest({
    organisationNamePrefix,
    siteCount
  })
  const { body } = expectStatus(
    await postAddOverseasSiteRequest(request.payload),
    201,
    `submit add-ORS request for "${request.organisationName}"`
  )
  return {
    ...request,
    submissionReference: body.submissionReference,
    workItems: body.workItems
  }
}

/** The add-ORS work items management-be holds for `organisationName`. */
export async function listAddOverseasSiteWorkItems(organisationName) {
  const query = new URLSearchParams({
    typeId: TYPE_ID,
    orgName: organisationName,
    pageSize: '50'
  })
  const { body } = expectStatus(
    await managementBeRequest('GET', `/work-items?${query}`, {
      user: CASEWORKER_USER
    }),
    200,
    `list add-ORS work items for "${organisationName}"`
  )
  return body.items
}
