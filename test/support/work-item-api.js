/**
 * RA-000. Path A: case-management-only work items, created over the API.
 *
 * Specs that need a rich application (overseas sites, interim sites, a
 * business plan, an exporter) cannot get one from the "Create work item"
 * form, which only captures a handful of fields. They used to read items
 * management-be's Development seeder had inserted, which never exist on CDP.
 * Instead, each spec now submits its own item to management-be's
 * `POST /work-items`, the same endpoint the operator journey submits to, with
 * the payload it needs.
 *
 * Every item is unique to its run:
 *
 *   - `organisationName` is `uniqueOrganisationName(prefix)`;
 *   - `operatorOrganisationId` is `e2e-<hex>`, which marks a test
 *     organisation, so management-be answers its ReEx lookups (the prior
 *     year's accreditation, RA-254) from its stub rather than real ReEx;
 *   - `operatorApplicationId` is fresh, because management-be treats a
 *     repeated one as a replay of an earlier submission;
 *   - the site (or, for an exporter, registered office) postcode has a random
 *     suffix, because the application reference is derived from it (see
 *     `unique-postcode.js`).
 *
 * Every operator and submitter email is GOV.UK Notify's simulated delivered
 * address, so a notification this item triggers is never a real email.
 *
 * Items created here are not known to the operator journey backend, so they
 * must never be approved or refused (the Registration & Accreditation service would refuse that push). Use
 * `operator-backend-api.js` for those.
 */

import { randomBytes } from 'node:crypto'

import { expectStatus, managementBeRequest } from './backend-api.js'
import { SIMULATED_DELIVERED_EMAIL } from './operator-backend-api.js'
import { uniqueOrganisationName } from './unique-name.js'
import { uniquePostcode } from './unique-postcode.js'

const hex = () => randomBytes(6).toString('hex')

/**
 * The fields every real submission carries. Fixtures spread their own
 * fields over this.
 */
function basePayload({ organisationName, token }) {
  return {
    organisationName,
    registrationNumber: `EPR-${token.slice(0, 6).toUpperCase()}`,
    operatorOrganisationId: `e2e-${token}`,
    operatorApplicationId: `e2e-app-${token}`,
    operatorRegistrationId: `e2e-reg-${token}`,
    material: 'plastic',
    accreditationYear: new Date().getUTCFullYear(),
    previousAccreditationYear: new Date().getUTCFullYear() - 1,
    complianceIssuesReported: 0,
    operatorEmail: SIMULATED_DELIVERED_EMAIL,
    companiesHouseNumber: '12345678',
    siteAddress: '1 E2E Way, London',
    siteAddressPostcode: uniquePostcode(),
    chargeAmountPence: 54600
  }
}

/**
 * Submit a re-accreditation work item and return
 *
 *   { id, organisationName, applicationReference, operatorOrganisationId,
 *     payload }
 *
 * `payload` is the payload management-be stored (with the nation and
 * reference it derived), so a spec can assert against the values actually
 * submitted. `fields` may be a function of the generated base payload, for a
 * fixture whose values depend on it (e.g. reusing the generated postcode).
 */
export async function createWorkItemViaApi({
  organisationNamePrefix,
  fields = {}
}) {
  const token = hex()
  const base = basePayload({
    organisationName: uniqueOrganisationName(organisationNamePrefix),
    token
  })
  const payload = {
    ...base,
    ...(typeof fields === 'function' ? fields(base) : fields)
  }
  const result = expectStatus(
    await managementBeRequest('POST', '/work-items', {
      body: { typeId: 're-accreditation', source: 'mgmt-tests', payload }
    }),
    201,
    `create work item for "${payload.organisationName}"`
  )
  const created = result.body
  return {
    id: created.id,
    organisationName: payload.organisationName,
    applicationReference: created.payload?.applicationReference,
    operatorOrganisationId: payload.operatorOrganisationId,
    payload: created.payload
  }
}
