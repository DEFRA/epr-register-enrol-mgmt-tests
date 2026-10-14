/**
 * RA-604 seed fixture map.
 *
 * These values mirror management-be's `duplicate-ors-names` seed. The first
 * two ORSs deliberately share a name; the remaining two prove that unique
 * names do not get a condensed address in their summary.
 */

export const ORG_NAME = 'Duplicate ORS Names Verification Ltd'

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
