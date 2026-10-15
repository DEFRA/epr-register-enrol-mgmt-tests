/**
 * RA-254 / RA-295 / RA-434 / RA-450 / RA-483 / RA-503: an application that
 * carries every field a real operator submission can send, including
 * submittedBy, prns, businessPlan, samplingPlan and overseas sites, so the
 * detail page's full rendering is exercised rather than the subset the
 * "Create work item" form can produce.
 *
 * Each call submits a new, uniquely named item (`work-item-api.js`). The
 * values are the ones management-be's former Development seeder gave its
 * "Full Payload Verification Ltd" item, which these specs used to look up by
 * name.
 *
 * The sampling-plan and BES-evidence files are uploaded through cdp-uploader
 * on every call (`cdp-uploader.js`), so their download links resolve to real
 * objects on CDP test and on the compose stack alike. The two sampling-plan
 * files have different bodies, so a link serving the wrong one is caught.
 */

import { uploadPdf } from './cdp-uploader.js'
import { uniquePostcode } from './unique-postcode.js'
import { createWorkItemViaApi } from './work-item-api.js'

/** Values the specs assert, kept beside the payload that carries them. */
export const FULL_PAYLOAD = {
  REGISTRATION_NUMBER: 'EPR-100999',
  // RA-503: the operator/regulator-safe organisation number, which the case
  // header, audit log and list card prefer over operatorOrganisationId.
  // Distinct from operatorOrganisationId (an `e2e-` test organisation id) so
  // asserting the preference has teeth.
  OPERATOR_ORG_NUMBER: '500010',
  COMPANY_REGISTERED_ADDRESS: '100 Registered Office Road, London, EC1A 1AB',
  SITE_ADDRESS: '1 Full Payload Lane, London',
  SITE_ADDRESS_POSTCODE: 'EC1A 1BB',
  SELECTED_OVERSEAS_SITE: {
    name: 'Full Payload Verification Overseas Site',
    town: 'Rotterdam',
    country: 'Netherlands'
  },
  // RA-483: a site the operator deselected before submitting. Case
  // management must not display it at all.
  REMOVED_OVERSEAS_SITE: {
    name: 'Removed Overseas Site',
    country: 'Germany'
  }
}

/** Upload one fixture PDF and stamp the upload time the specs assert. */
async function fixturePdf(filename, content, uploadedAt) {
  // A real submission sends uploadedAt as an ISO-8601 string, never a BSON
  // date.
  return { ...(await uploadPdf(filename, content)), uploadedAt }
}

/**
 * Submit a new full-payload item. Returns what `createWorkItemViaApi`
 * returns: `{ id, organisationName, applicationReference,
 * operatorOrganisationId, payload }`.
 */
export async function createFullPayloadWorkItem() {
  const [samplingPlan, samplingPlanAppendix, besEvidence] = await Promise.all([
    fixturePdf(
      'sampling-plan.pdf',
      '%PDF-1.4 fixture content for e2e download tests',
      '2026-06-01T10:00:00.000Z'
    ),
    fixturePdf(
      'sampling-plan-appendix.pdf',
      '%PDF-1.4 appendix fixture content for e2e download tests',
      '2026-06-02T10:00:00.000Z'
    ),
    fixturePdf(
      'bes-evidence.pdf',
      '%PDF-1.4 BES evidence fixture content for e2e download tests',
      '2026-06-01T10:00:00.000Z'
    )
  ])
  return createWorkItemViaApi({
    organisationNamePrefix: 'Full Payload Verification Ltd',
    fields: {
      registrationNumber: FULL_PAYLOAD.REGISTRATION_NUMBER,
      operatorOrgNumber: Number(FULL_PAYLOAD.OPERATOR_ORG_NUMBER),
      // RA-412: carries overseas sites and BES evidence, so it declares the
      // exporter discriminator management-fe reads.
      wasteProcessingType: 'exporter',
      // An exporter's regulator (and the application reference's postcode
      // segment) comes from its registered office, so this one is unique per
      // item (see unique-postcode.js).
      companyRegisterAddressPostcode: uniquePostcode('EC1A'),
      material: 'plastic',
      companiesHouseNumber: '12345678',
      companyRegisteredAddress: FULL_PAYLOAD.COMPANY_REGISTERED_ADDRESS,
      siteAddress: FULL_PAYLOAD.SITE_ADDRESS,
      siteAddressPostcode: FULL_PAYLOAD.SITE_ADDRESS_POSTCODE,
      permitNumbers: ['WML999000', 'PPC888777'],
      chargeAmountPence: 327600,
      paymentReference: 'PAY-FULL-PAYLOAD-001',
      submittedBy: {
        fullName: 'Priya Sharma',
        jobTitle: 'Compliance Manager',
        email: 'simulate-delivered@notifications.service.gov.uk'
      },
      prns: {
        plannedTonnageBand: 'UpTo5000',
        authorisers: [{ fullName: 'Tom Baker', email: 'tom.baker@example.com' }]
      },
      // RA-456: all seven percentages sum to 100.
      businessPlan: {
        newInfrastructurePercent: 20,
        priceSupportPercent: 15,
        businessCollectionsPercent: 20,
        communicationsPercent: 10,
        newMarketsPercent: 15,
        newUsesPercent: 10,
        otherPercent: 10,
        newInfrastructureDetail: 'New sorting line investment',
        priceSupportDetail: 'Subsidised collection scheme',
        businessCollectionsDetail: 'Kerbside collection expansion',
        communicationsDetail: 'Customer awareness campaign',
        newMarketsDetail: 'New export contracts secured',
        newUsesDetail: 'Recycled content packaging trial',
        otherDetail:
          'Contribution to sector-wide research and development initiatives'
      },
      // RA-295 AC02: more than one file, so a template that renders only
      // files[0] is caught.
      samplingPlan: { files: [samplingPlan, samplingPlanAppendix] },
      overseasSites: {
        sites: [
          {
            siteId: 1,
            siteName: FULL_PAYLOAD.SELECTED_OVERSEAS_SITE.name,
            siteAddress: '1 Overseas Lane, Rotterdam',
            country: FULL_PAYLOAD.SELECTED_OVERSEAS_SITE.country,
            selected: true,
            besEvidence: { files: [besEvidence] }
          },
          {
            siteId: 2,
            siteName: FULL_PAYLOAD.REMOVED_OVERSEAS_SITE.name,
            siteAddress: '2 Withdrawn Weg, Hamburg',
            country: FULL_PAYLOAD.REMOVED_OVERSEAS_SITE.country,
            selected: false,
            besEvidence: { files: [] }
          }
        ]
      }
    }
  })
}
