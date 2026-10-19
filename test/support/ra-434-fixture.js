/**
 * RA-434 fixtures: the two kinds of application the "Additional information"
 * tab spec asserts against, covering the tab's one real conditional (the Site
 * address row's reprocessor/exporter fallback).
 *
 *   - REPROCESSOR carries NO `wasteProcessingType` at all:
 *     RA-434-processortype's whole point is the "absent defaults to
 *     reprocessor" branch, so the fixture proving it must genuinely lack the
 *     field.
 *   - EXPORTER has `wasteProcessingType: "exporter"`, no site address (an
 *     exporter has no UK site), and submitter contact details, which only the
 *     exporter branch renders.
 *
 * Each `create*` call submits a new, uniquely named item through the API
 * (`work-item-api.js`), with the values management-be's former Development
 * seeder gave its two "additional information" items. The constants are the
 * values the spec asserts. The regulator postcode (the site postcode for a
 * reprocessor, the registered office's for an exporter) is unique per item,
 * because the application reference is derived from it; read it from the
 * returned `payload`.
 */

import { SIMULATED_DELIVERED_EMAIL } from './operator-backend-api.js'
import { uniquePostcode } from './unique-postcode.js'
import { createWorkItemViaApi } from './work-item-api.js'

export const REPROCESSOR = {
  COMPANIES_HOUSE_NUMBER: '13579246',
  COMPANY_REGISTERED_ADDRESS: '200 Registered Office Road, London, SE1 9AA',
  SITE_ADDRESS_LINE: '1 Thames Reprocessing Way',
  PERMIT_NUMBERS_JOINED: 'WML135792, PPC468024'
}

export const EXPORTER = {
  COMPANIES_HOUSE_NUMBER: '09876543',
  COMPANY_REGISTERED_ADDRESS: '1 Continental Way, Dover, Kent',
  PERMIT_NUMBERS_JOINED: 'WML123456, PPC456789',
  CONTACT_FULL_NAME: 'Barton Deckow',
  CONTACT_EMAIL: SIMULATED_DELIVERED_EMAIL,
  CONTACT_PHONE: '0111 478 4919',
  CONTACT_JOB_TITLE: 'Human Infrastructure Architect'
}

export function createReprocessorWorkItem() {
  return createWorkItemViaApi({
    organisationNamePrefix: 'Thames Reprocessing Verification Ltd',
    fields: {
      material: 'plastic',
      companiesHouseNumber: REPROCESSOR.COMPANIES_HOUSE_NUMBER,
      companyRegisteredAddress: REPROCESSOR.COMPANY_REGISTERED_ADDRESS,
      siteAddress: `${REPROCESSOR.SITE_ADDRESS_LINE}, London`,
      siteAddressPostcode: uniquePostcode('SE1'),
      permitNumbers: ['WML135792', 'PPC468024'],
      chargeAmountPence: 218400
    }
  })
}

export function createExporterWorkItem() {
  return createWorkItemViaApi({
    organisationNamePrefix: 'Continental Exports Verification Ltd',
    fields: (base) => {
      const { siteAddress, siteAddressPostcode, ...withoutSite } = base
      return {
        ...withoutSite,
        material: 'plastic',
        wasteProcessingType: 'exporter',
        companiesHouseNumber: EXPORTER.COMPANIES_HOUSE_NUMBER,
        companyRegisteredAddress: EXPORTER.COMPANY_REGISTERED_ADDRESS,
        companyRegisterAddressPostcode: uniquePostcode('CT16'),
        permitNumbers: ['WML123456', 'PPC456789'],
        chargeAmountPence: 218400,
        submitterContactDetails: {
          fullName: EXPORTER.CONTACT_FULL_NAME,
          email: EXPORTER.CONTACT_EMAIL,
          phone: EXPORTER.CONTACT_PHONE,
          jobTitle: EXPORTER.CONTACT_JOB_TITLE
        }
      }
    }
  })
}
