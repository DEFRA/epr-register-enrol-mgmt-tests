/**
 * RA-603 fixture: an exporter application whose single ORS carries three
 * interim sites, two active and one withdrawn (`removedAt`). That mix is
 * deliberate — a fixture of identical, all-active interim sites would pass
 * just as well against a page that rendered only the first, badged every
 * site as new, or ignored `removedAt` entirely.
 *
 * `createMultipleInterimSitesWorkItem` submits a new, uniquely named item
 * through the API (`work-item-api.js`), with the values management-be's
 * former Development seeder gave its `multiple-interim-sites` item.
 */

import { uniquePostcode } from './unique-postcode.js'
import { createWorkItemViaApi } from './work-item-api.js'

export const REGISTRATION_NUMBER = 'EPR-100603'

/** The single overseas reprocessing site that carries all three interim sites. */
export const ORS_NAME = 'Valencia Fibre Reprocessing'

/**
 * The two interim sites the operator has NOT withdrawn, in the order the page renders them.
 * `BILBAO` is established, `MARSEILLE` is new — both polarities on the same ORS, so the "new"
 * badge assertions compare two siblings rather than trusting one.
 */
export const ACTIVE_INTERIM_SITES = [
  {
    name: 'Bilbao Interim Holding',
    country: 'Spain',
    townOrCity: 'Bilbao',
    siteNumber: '001',
    operationCodes: ['R12'],
    isNew: false
  },
  {
    name: 'Marseille Interim Depot',
    country: 'France',
    townOrCity: 'Marseille',
    siteNumber: '002',
    operationCodes: ['R12', 'R13'],
    isNew: true
  }
]

/**
 * Withdrawn, and therefore absent from the regulator's view.
 *
 * AC05 keeps a withdrawn interim site in the record for reporting; the detail page is not where
 * that reporting happens, so a caseworker reviewing the application sees what is on it now. This
 * is the entry that makes the spec meaningful — without it, a view that ignored `removedAt`
 * entirely would pass every other assertion here.
 */
export const WITHDRAWN_INTERIM_SITE = {
  name: 'Genoa Interim Store',
  country: 'Italy',
  siteNumber: '003'
}

const interimSite = (
  siteId,
  { name, country, townOrCity, siteNumber, operationCodes, isNew },
  addressLine1,
  removedAt
) => ({
  siteId,
  siteNumber,
  isNewSite: isNew,
  country,
  siteName: name,
  addressLine1,
  townOrCity,
  contactName: 'Site Contact',
  contactEmail: 'site.contact@example.com',
  contactPhone: '+34 96 765 4321',
  operationCodes,
  createdAt: '2026-06-01T10:00:00.000Z',
  ...(removedAt ? { removedAt } : {})
})

export function createMultipleInterimSitesWorkItem() {
  const [bilbao, marseille] = ACTIVE_INTERIM_SITES
  const bilbaoSite = interimSite(21, bilbao, '9 Muelle de Zorroza')
  return createWorkItemViaApi({
    organisationNamePrefix: 'Iberian Fibre Exports',
    fields: {
      registrationNumber: REGISTRATION_NUMBER,
      wasteProcessingType: 'exporter',
      // An exporter's regulator (and the application reference's postcode
      // segment) comes from its registered office, so this is unique per item.
      companyRegisterAddressPostcode: uniquePostcode('CF10'),
      material: 'fibre',
      companiesHouseNumber: '16003603',
      overseasSites: {
        sites: [
          {
            siteId: 1,
            orsId: 'ORS-2026-0603',
            siteName: ORS_NAME,
            siteAddress: '4 Carrer del Port, Valencia',
            addressLine1: '4 Carrer del Port',
            townOrCity: 'Valencia',
            country: 'Spain',
            contactName: 'Elena Ruiz',
            contactEmail: 'elena.ruiz@example.com',
            contactPhone: '+34 96 123 4567',
            operationCodes: ['R3'],
            isEu: true,
            isOecd: true,
            selected: true,
            isNewSite: false,
            registeredNowAccredited: false,
            // The single-site field an older reader uses, alongside the list.
            interimSite: bilbaoSite,
            interimSites: [
              bilbaoSite,
              interimSite(22, marseille, '12 Quai du Lazaret'),
              interimSite(
                23,
                {
                  ...WITHDRAWN_INTERIM_SITE,
                  townOrCity: 'Genoa',
                  operationCodes: ['R13'],
                  isNew: false
                },
                '3 Via al Porto Antico',
                '2026-08-14T09:30:00.000Z'
              )
            ]
          }
        ]
      }
    }
  })
}
