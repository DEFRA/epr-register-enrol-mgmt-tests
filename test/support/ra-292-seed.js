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
    // The middle address line matters more than it looks: it is the line a
    // first-match read or a naive two-field join silently drops, while the
    // page still shows a plausible-looking address.
    addressLine2: 'Europoort Industrial Park',
    town: 'Rotterdam',
    country: 'Netherlands',
    coordinates: '51.9244, 4.4777',
    contactName: 'Johan de Vries',
    contactEmail: 'johan.devries@example.com',
    contactPhone: '+31 10 123 4567',
    operationCode: 'R3',
    wasteCodes: ['B3011', 'GH013', 'Y48'],
    repatriatedLoads: '3',
    // `conditionsOfExport` is a nullable BOOLEAN, not the free text an earlier
    // draft of the seed map described — confirmed against legacy-be's model
    // (`public bool? ConditionsOfExport`) rather than taken on report. It is
    // the one nullable field among the flags: Rotterdam true, Hamburg false,
    // absent on Port Klang and Bilbao, so "absent from an otherwise-complete
    // site" is a real production shape and not bad data.
    conditionsOfExport: 'Yes',
    // Rendered as Yes/No by management-fe, not as the raw JSON boolean.
    registeredNowAccredited: 'No',
    euCountry: 'Yes',
    oecdCountry: 'Yes'
  },
  ESTABLISHED: {
    name: 'Hamburg Established Reprocessing Site',
    orsId: 'ORS-2024-0042',
    address: '42 Hafenstrasse',
    addressLine2: 'Building C',
    town: 'Hamburg',
    country: 'Germany',
    coordinates: '53.5511, 9.9937',
    contactName: 'Anna Schmidt',
    contactEmail: 'anna.schmidt@example.com',
    contactPhone: '+49 40 555 0142',
    operationCode: 'R4',
    wasteCodes: ['B1010', 'GA300', 'Y23'],
    // Zero loads, and a genuinely different fact from "we were never told".
    //
    // NOTE ON TYPE: `repatriatedLoads` crosses the wire as a STRING, not a
    // number (verified against serialised legacy-be output on RA-292). That
    // matters for how much this value proves: `"0"` is truthy, so it survives
    // even a naive truthiness-based omission check. It is still worth pinning
    // — a value that must appear on screen — but the real falsy-omission
    // coverage comes from the BOOLEAN fields below, which are true booleans on
    // the wire and therefore genuinely falsy when false.
    repatriatedLoads: '0',
    conditionsOfExport: 'No',
    registeredNowAccredited: 'Yes',
    euCountry: 'Yes',
    oecdCountry: 'Yes'
  },
  /**
   * The non-EU, non-OECD site. It exists so `isEu: false` / `isOecd: false`
   * have somewhere real to be observed.
   *
   * Deliberately a genuinely non-EU, non-OECD country rather than one of the
   * European sites flipped to false. A fixture that asserts something
   * factually untrue to reach a code path is worse than the gap it closes:
   * the next person to read it cannot tell the difference between a fact and
   * a testing convenience, and starts distrusting the rest of the file.
   *
   * `isNewSite` is false, chosen so the page still carries exactly one New
   * tag and the AC01 count assertions hold with four sites instead of three.
   */
  NON_EU: {
    name: 'Port Klang Reprocessing Facility',
    orsId: 'ORS-2025-0113',
    address: '88 Jalan Pelabuhan',
    addressLine2: 'Zone 3',
    town: 'Port Klang',
    country: 'Malaysia',
    coordinates: '3.0044, 101.3928',
    contactName: 'Aisyah Rahman',
    contactEmail: 'aisyah.rahman@example.com',
    contactPhone: '+60 3 3168 8000',
    operationCode: 'R3',
    wasteCodes: ['B3011', 'GH013', 'Y48'],
    repatriatedLoads: '2',
    registeredNowAccredited: 'No',
    euCountry: 'No',
    oecdCountry: 'No'
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
    addressLine2: 'Unit 4',
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
