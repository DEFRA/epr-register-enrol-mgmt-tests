/**
 * RA-604 fixture: the RA-292 four-site application with its first two ORSs
 * renamed to share a name. The remaining two prove that unique names do not
 * get a condensed address in their summary.
 *
 * `createDuplicateOrsNamesWorkItem` submits a new, uniquely named item
 * through the API (`work-item-api.js`), as management-be's former
 * Development seeder built its `duplicate-ors-names` item.
 */

import { orsInterimAuthorityFields } from './ra-292-fixture.js'
import { createWorkItemViaApi } from './work-item-api.js'

export const SHARED_ORS_NAME = 'Shared Reprocessing Site'

export const DUPLICATE_ORS = [
  {
    summaryAddress: '1 Havenstraat, Netherlands',
    fullAddress:
      '1 Havenstraat, Europoort Industrial Park, Rotterdam, Netherlands'
  },
  {
    summaryAddress: '42 Hafenstrasse, Germany',
    fullAddress: '42 Hafenstrasse, Building C, Hamburg, Germany'
  }
]

export const UNIQUE_ORS_NAMES = [
  'Bilbao Legacy Reprocessing Site',
  'Port Klang Reprocessing Facility'
]

export function createDuplicateOrsNamesWorkItem() {
  const fields = orsInterimAuthorityFields()
  fields.registrationNumber = 'EPR-100604'
  fields.overseasSites.sites[0].siteName = SHARED_ORS_NAME
  fields.overseasSites.sites[1].siteName = SHARED_ORS_NAME
  return createWorkItemViaApi({
    organisationNamePrefix: 'Duplicate ORS Names Verification Ltd',
    fields
  })
}
