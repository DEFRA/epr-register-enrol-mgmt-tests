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

import { expectStatus, managementBeRequest } from './backend-api.js'
import { uniqueOrganisationName } from './unique-name.js'

const hex = () => randomBytes(6).toString('hex')

/**
 * Submit an add-ORS request with `siteCount` sites and return
 *
 *   { submissionReference, workItems: [{ siteId, id, applicationReference }],
 *     organisationName, operatorOrgNumber, sites }
 *
 * `workItems` is management-be's response, in site order; `sites` is what
 * was submitted, in the same order.
 */
export async function submitAddOverseasSiteRequest({
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
    changeType: 'add-overseas-site',
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

  const { body } = expectStatus(
    await managementBeRequest('POST', '/work-items', {
      body: { typeId: 'add-overseas-site', source: 'mgmt-tests', payload }
    }),
    201,
    `submit add-ORS request for "${organisationName}"`
  )
  return {
    submissionReference: body.submissionReference,
    workItems: body.workItems,
    organisationName,
    operatorOrgNumber,
    sites
  }
}
