/**
 * RA-292 seed fixture map.
 *
 * These values are OWNED BY management-be, not by this suite. They are seeded
 * by `ReAccreditationSeeder` (seed key `ors-interim-authority`) and reproduced
 * here so the two RA-292 spec files assert against one copy rather than two
 * drifting ones — the same reasoning behind CASE_HEADER_FIELDS living in the
 * page object.
 *
 * Why a whole fixture module for one seed item: the item is deliberately
 * built to exercise every observable state of the three RA-292 flags at once
 * (true / false / key-absent), so nearly every assertion in the feature is a
 * comparison between two sites on the SAME page. Naming those sites in one
 * place is what keeps "the new one" and "the established one" from being
 * hand-copied string literals scattered across two files.
 *
 * The seeder inserts via CreateIfAbsentAsync keyed on a deterministic id, so
 * this item appears on the next backend boot even against a mongo volume that
 * has already been seeded — no `docker compose down -v` is needed to pick it
 * up. If any value below stops matching, the seeder changed: fix it here, not
 * in the specs.
 */

/** The organisation name that resolves the work-items search to this one item. */
export const ORG_NAME = 'Overseas Reprocessing Verification Ltd'

export const REGISTRATION_NUMBER = 'EPR-100292'

/**
 * The pre-RA-292 work item used for the backwards-compatibility case: it
 * carries no `overseasSites` and no `prns` at all, so it is what a case
 * created before this story looks like when rendered by the new template.
 */
export const LEGACY_ORG_NAME = 'Belfast Fibres Co'

/**
 * The three ORS sites, covering `isNewSite` true / false / absent.
 *
 * `NEW` and `ESTABLISHED` are the positive/negative pair the badge
 * conditionality rests on. `LEGACY` is the third state that a true/false pair
 * alone cannot catch: a template written as `{% if site.isNewSite != false %}`
 * badges a site whose key is simply missing, which is every site on every
 * case submitted before this story shipped.
 */
export const ORS = {
  NEW: {
    name: 'Rotterdam New Reprocessing Site',
    orsId: 'ORS-2026-0292',
    address: '1 Havenstraat',
    town: 'Rotterdam',
    country: 'Netherlands',
    coordinates: '51.9244, 4.4777',
    contactName: 'Johan de Vries',
    contactEmail: 'johan.devries@example.com',
    contactPhone: '+31 10 123 4567',
    operationCode: 'R3',
    wasteCodes: ['B3011', 'GH013', 'Y48'],
    repatriatedLoads: '3',
    conditionsOfExport:
      'Baled material, moisture content below 5%, shipped under Annex VII controls.',
    // Rendered as Yes/No by management-fe, not as the raw JSON boolean.
    registeredNowAccredited: 'No',
    euCountry: 'Yes',
    oecdCountry: 'Yes'
  },
  ESTABLISHED: {
    name: 'Hamburg Established Reprocessing Site',
    orsId: 'ORS-2024-0042',
    address: '42 Hafenstrasse',
    town: 'Hamburg',
    country: 'Germany',
    coordinates: '53.5511, 9.9937',
    contactName: 'Anna Schmidt',
    contactEmail: 'anna.schmidt@example.com',
    contactPhone: '+49 40 555 0142',
    operationCode: 'R4',
    wasteCodes: ['B1010', 'GA300', 'Y23'],
    // A real JSON zero, deliberately. See the falsy-value spec: 0 is a
    // meaningful answer and must render, not be omitted as though absent.
    repatriatedLoads: '0',
    conditionsOfExport: 'Loose material, shipped under Annex VII controls.',
    registeredNowAccredited: 'Yes',
    euCountry: 'Yes',
    oecdCountry: 'Yes'
  },
  /**
   * Near-minimal: siteId, orsId, siteName, siteAddress, townOrCity and country
   * only. No `isNewSite`, no contact, no codes, and no `interimSite` at all.
   */
  LEGACY: {
    name: 'Bilbao Legacy Reprocessing Site',
    orsId: 'ORS-2023-0007',
    address: '7 Muelle Tomas Olabarri',
    town: 'Bilbao',
    country: 'Spain'
  }
}

/**
 * The interim sites, one per ORS, covering `isNewSite` true / false. The third
 * ORS has none, which is the "absent" case for interim sites.
 */
export const INTERIM = {
  NEW: {
    name: 'Antwerp Interim Holding Site',
    siteNumber: 'INT-001',
    address: '12 Scheldelaan',
    town: 'Antwerp',
    country: 'Belgium',
    contactName: 'Elke Janssens',
    contactEmail: 'elke.janssens@example.com',
    contactPhone: '+32 3 987 6543'
  },
  ESTABLISHED: {
    name: 'Bremen Interim Storage',
    siteNumber: 'INT-002',
    address: '8 Speicherstrasse',
    town: 'Bremen',
    country: 'Germany',
    contactName: 'Lukas Braun',
    contactEmail: 'lukas.braun@example.com',
    contactPhone: '+49 421 555 0188'
  }
}

/**
 * The authority-to-issue contacts, covering `isNew` true / false / absent.
 *
 * Grace Adeyemi is also the item's `submittedBy`, which is deliberate on
 * management-be's part: the same person appearing in two roles is what proves
 * the "New" flag is read from the authoriser entry rather than inferred from
 * whoever submitted the application.
 */
export const AUTHORISERS = {
  NEW: {
    name: 'Grace Adeyemi',
    email: 'grace.adeyemi@example.com'
  },
  ESTABLISHED: {
    name: 'Martin Cole',
    email: 'martin.cole@example.com'
  },
  LEGACY: {
    name: 'Priya Nair',
    email: 'priya.nair@example.com'
  }
}
