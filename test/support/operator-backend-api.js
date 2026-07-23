/**
 * RA-311/MGT-F1 — direct read of epr-register-enrol-backend's
 * `GetById` endpoint.
 *
 * Like management-be-api.js's calls into management-be, this runs from the
 * Node test process (plain `fetch` against the published port) rather than
 * the browser: there is no operator-facing UI wired to a case-management-
 * linked application in this stack, and GetById needs no auth in this
 * service, so there's nothing to route around by going through a page.
 */
const OPERATOR_BE_URL = process.env.OPERATOR_BE_URL || 'http://localhost:8080'

/**
 * GET api/v1/accreditation-applications/{organisationId}/{applicationId}
 */
export async function getAccreditationApplication(
  organisationId,
  applicationId
) {
  const response = await fetch(
    `${OPERATOR_BE_URL}/api/v1/accreditation-applications/${organisationId}/${applicationId}`
  )
  return response.json()
}
