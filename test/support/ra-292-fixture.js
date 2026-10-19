/**
 * RA-292 fixture: the ORS / interim-site / authority-to-issue application.
 *
 * The item is deliberately built to exercise every observable state of the
 * three RA-292 flags at once (true / false / key-absent), so nearly every
 * assertion in the feature is a comparison between two sites on the SAME
 * page. Naming those sites in one place is what keeps "the new one" and "the
 * established one" from being hand-copied string literals scattered across
 * the specs that use it.
 *
 *   overseasSites.sites[0]  isNewSite = true   + interimSite isNewSite = true
 *   overseasSites.sites[1]  isNewSite = false  + interimSite isNewSite = false
 *   overseasSites.sites[2]  isNewSite absent   + no interimSite at all
 *   overseasSites.sites[3]  isNewSite = false  + no interimSite; isEu/isOecd false
 *   prns.authorisers[0]     isNew = true
 *   prns.authorisers[1]     isNew = false
 *   prns.authorisers[2]     isNew absent
 *
 * `createOrsInterimAuthorityWorkItem` submits a new, uniquely named item
 * through the API (`work-item-api.js`) with the values management-be's
 * former Development seeder gave its `ors-interim-authority` item. The
 * constants below are the values the specs assert, and the payload is built
 * from them.
 *
 * Field TYPES follow a captured operator-backend payload, and two of them are
 * counter-intuitive: `repatriatedLoads` is a STRING and `conditionsOfExport`
 * a nullable boolean.
 */

import { uploadPdf } from './cdp-uploader.js'
import { SIMULATED_DELIVERED_EMAIL } from './operator-backend-api.js'
import { uniquePostcode } from './unique-postcode.js'
import { createWorkItemViaApi } from './work-item-api.js'

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
    // RA-486: siteId, as submitted in the payload — used to build the
    // `recycling-operations-site-{siteId}` testid on the Recycling
    // operations tab (RA-469). Not used anywhere on the Application summary
    // tab, which locates blocks by name instead.
    siteId: 1,
    orsId: 'ORS-2026-0292',
    address: '1 Havenstraat',
    // The middle address line matters more than it looks: it is the line a
    // first-match read or a naive join silently drops, while the page still
    // shows a plausible-looking address. Asserted via `fullAddress` below,
    // never as a substring, for exactly that reason.
    addressLine2: 'Europoort Industrial Park',
    town: 'Rotterdam',
    fullAddress:
      '1 Havenstraat, Europoort Industrial Park, Rotterdam, Netherlands',
    country: 'Netherlands',
    coordinates: '51.9244, 4.4777',
    contactName: 'Johan de Vries',
    contactEmail: 'johan.devries@example.com',
    contactPhone: '+31 10 123 4567',
    operationCode: 'R3',
    wasteCodes: ['B3011', 'GH013', 'Y48'],
    repatriatedLoads: '3',
    // `conditionsOfExport` is a nullable BOOLEAN, not the free text an earlier
    // draft of this fixture map described — confirmed against legacy-be's model
    // (`public bool? ConditionsOfExport`) rather than taken on report. It is
    // the one nullable field among the flags: Rotterdam true, Hamburg false,
    // absent on Port Klang and Bilbao, so "absent from an otherwise-complete
    // site" is a real production shape and not bad data.
    conditionsOfExport: 'Yes',
    // Rendered as Yes/No by management-fe, not as the raw JSON boolean.
    registeredNowAccredited: 'No',
    euCountry: 'Yes',
    oecdCountry: 'Yes',
    // RA-486 / RA-469. The STRUCTURED code array the Recycling operations
    // tab reads (`site.operationCodes`, plural) — a separate field from the
    // legacy free-text `operationCode` (singular) above, which
    // application-summary.js's ORS_DETAIL_FIELDS still reads independently.
    // R12 requires an accompanying non-R12/R13 code AND an associated
    // interim site (recycling-operations.schema.js's
    // CODES_REQUIRING_ACCOMPANIMENT / requiresInterimSite) — both are true
    // here, so this is a valid combination, not just a convenient one.
    operationCodes: ['R3', 'R12']
  },
  ESTABLISHED: {
    name: 'Hamburg Established Reprocessing Site',
    siteId: 2,
    orsId: 'ORS-2024-0042',
    address: '42 Hafenstrasse',
    addressLine2: 'Building C',
    town: 'Hamburg',
    fullAddress: '42 Hafenstrasse, Building C, Hamburg, Germany',
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
    oecdCountry: 'Yes',
    // RA-486. Deliberately carries NO R12/R13 despite having an associated
    // interim site (Bremen, below) — this is the fixture that proves the
    // Recycling operations tab's "Associated interim site" line is shown
    // whenever the ORS HAS an interim site, not whenever it carries R12/R13.
    // Before RA-486 those two were coupled; a regression that re-coupled
    // them would hide this line even though Hamburg genuinely has an
    // interim site, and this fixture is the only one that can catch it —
    // Rotterdam's R12 would pass either way.
    operationCodes: ['R4']
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
    siteId: 4,
    orsId: 'ORS-2025-0113',
    address: '88 Jalan Pelabuhan',
    addressLine2: 'Zone 3',
    town: 'Port Klang',
    fullAddress: '88 Jalan Pelabuhan, Zone 3, Port Klang, Malaysia',
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
    oecdCountry: 'No',
    // RA-486. Empty rather than absent, and paired with no interimSite at
    // all — the AC7 "no codes" state on a site that also has no associated
    // interim site, distinct from LEGACY below (which carries no
    // `operationCodes` KEY at all rather than an empty array). Both must
    // render the same "No recycling operation codes are set" row.
    operationCodes: []
  },
  /**
   * Near-minimal: siteId, orsId, siteName, siteAddress, townOrCity and country
   * only. No `isNewSite`, no contact, no codes, and no `interimSite` at all.
   */
  LEGACY: {
    name: 'Bilbao Legacy Reprocessing Site',
    siteId: 3,
    orsId: 'ORS-2023-0007',
    address: '7 Muelle Tomas Olabarri',
    town: 'Bilbao',
    country: 'Spain',
    // The only site with NO structured address lines — it carries the
    // legacy flat `siteAddress` ("7 Muelle Tomas Olabarri, Bilbao") which
    // already embeds its own town. Joining that against `townOrCity` and
    // `country` naively would render "…, Bilbao, Bilbao, Spain", so this
    // single string is the one assertion covering management-fe's segment-wise
    // de-duplication. No other site can exercise it.
    fullAddress: '7 Muelle Tomas Olabarri, Bilbao, Spain'
  }
}

/**
 * The interim sites, one per ORS, covering `isNewSite` true / false. The third
 * ORS has none, which is the "absent" case for interim sites.
 */
export const INTERIM = {
  NEW: {
    name: 'Antwerp Interim Holding Site',
    siteNumber: '001',
    address: '12 Scheldelaan',
    addressLine2: 'Unit 4',
    town: 'Antwerp',
    // The interim wire shape carries stateOrRegion and postcode, which the ORS
    // shape does not — hence the two extra segments here and none on any ORS.
    fullAddress: '12 Scheldelaan, Unit 4, Antwerp, Flanders, 2030, Belgium',
    country: 'Belgium',
    contactName: 'Elke Janssens',
    contactEmail: 'elke.janssens@example.com',
    contactPhone: '+32 3 987 6543',
    // RA-486. The interim site's own recycling operation code(s) — display
    // only on the Application summary tab (`interim-site-operation-code`,
    // same reader shape as the ORS side's `overseas-site-operation-code`; no
    // edit capability exists for this field on the regulator side). Submitted
    // as an ARRAY (mandatory R12 plus an optional R3) rather than a bare
    // string so this fixture also proves toDisplayLines()'s array branch —
    // ORS.NEW's own operationCode has only ever exercised the string one.
    operationCode: ['R12', 'R3']
  },
  ESTABLISHED: {
    name: 'Bremen Interim Storage',
    siteNumber: '002',
    address: '8 Speicherstrasse',
    town: 'Bremen',
    // Bremen is a German CITY-STATE: `townOrCity` and `stateOrRegion` are both
    // "Bremen" in the payload, and that is correct data rather than a duplicate to
    // be cleaned. This is the one address whose expected value is a real
    // question rather than a derivation — management-fe de-duplicates adjacent
    // segments to stop the legacy flat `siteAddress` re-stating a part, and
    // that same rule would collapse a legitimate repeat here (as it would for
    // New York, New York or Luxembourg, Luxembourg).
    //
    // Pinned as the un-collapsed form, confirmed against the rendered page.
    // Whichever way it renders, asserting it makes the behaviour a decision
    // instead of a side effect.
    fullAddress: '8 Speicherstrasse, Bremen, Bremen, 28217, Germany',
    country: 'Germany',
    contactName: 'Lukas Braun',
    contactEmail: 'lukas.braun@example.com',
    contactPhone: '+49 421 555 0188',
    // RA-486. A single mandatory code (R13), unlike Antwerp's array of two —
    // the pair together cover both the array and single-string shapes
    // toDisplayLines() accepts.
    operationCode: 'R13'
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

/**
 * The RA-292 payload fields, for this fixture and for fixtures derived from
 * it (RA-604's duplicate ORS names).
 */
export async function orsInterimAuthorityFields() {
  // Uploaded through cdp-uploader, so the file this item lists is a real
  // object rather than a dangling key.
  const besEvidenceFile = {
    ...(await uploadPdf(
      'bes-evidence.pdf',
      '%PDF-1.4 RA-292 BES evidence fixture content'
    )),
    uploadedAt: '2026-06-01T10:00:00.000Z',
    besEvidenceValidFromDate: '2026-01-01T00:00:00Z',
    besEvidenceExpiryDate: '2027-01-01T00:00:00Z'
  }
  return {
    registrationNumber: 'EPR-100292',
    wasteProcessingType: 'exporter',
    // An exporter's regulator (and the application reference's postcode
    // segment) comes from its registered office, so this is unique per item.
    companyRegisterAddressPostcode: uniquePostcode('SA1'),
    material: 'plastic',
    companiesHouseNumber: '12131415',
    siteAddress: '1 Verification Way, London',
    chargeAmountPence: 218400,
    submittedBy: {
      fullName: AUTHORISERS.NEW.name,
      jobTitle: 'Head of Compliance',
      email: SIMULATED_DELIVERED_EMAIL
    },
    prns: {
      plannedTonnageBand: 'UpTo5000',
      authorisers: [
        {
          fullName: AUTHORISERS.NEW.name,
          email: AUTHORISERS.NEW.email,
          isNew: true
        },
        {
          fullName: AUTHORISERS.ESTABLISHED.name,
          email: AUTHORISERS.ESTABLISHED.email,
          isNew: false
        },
        { fullName: AUTHORISERS.LEGACY.name, email: AUTHORISERS.LEGACY.email }
      ]
    },
    overseasSites: {
      sites: [
        {
          siteId: ORS.NEW.siteId,
          orsId: ORS.NEW.orsId,
          siteName: ORS.NEW.name,
          siteAddress: `${ORS.NEW.address}, ${ORS.NEW.town}`,
          addressLine1: ORS.NEW.address,
          addressLine2: ORS.NEW.addressLine2,
          townOrCity: ORS.NEW.town,
          country: ORS.NEW.country,
          coordinates: ORS.NEW.coordinates,
          contactName: ORS.NEW.contactName,
          contactEmail: ORS.NEW.contactEmail,
          contactPhone: ORS.NEW.contactPhone,
          operationCode: ORS.NEW.operationCode,
          operationCodes: ORS.NEW.operationCodes,
          code1: ORS.NEW.wasteCodes[0],
          code2: ORS.NEW.wasteCodes[1],
          code3: ORS.NEW.wasteCodes[2],
          repatriatedLoads: ORS.NEW.repatriatedLoads,
          conditionsOfExport: true,
          isEu: true,
          isOecd: true,
          isNewSite: true,
          registeredNowAccredited: false,
          besEvidence: { files: [besEvidenceFile] },
          interimSite: {
            siteId: 11,
            siteNumber: INTERIM.NEW.siteNumber,
            isNewSite: true,
            country: INTERIM.NEW.country,
            siteName: INTERIM.NEW.name,
            addressLine1: INTERIM.NEW.address,
            addressLine2: INTERIM.NEW.addressLine2,
            townOrCity: INTERIM.NEW.town,
            stateOrRegion: 'Flanders',
            postcode: '2030',
            contactName: INTERIM.NEW.contactName,
            contactEmail: INTERIM.NEW.contactEmail,
            contactPhone: INTERIM.NEW.contactPhone,
            operationCodes: INTERIM.NEW.operationCode
          }
        },
        {
          siteId: ORS.ESTABLISHED.siteId,
          orsId: ORS.ESTABLISHED.orsId,
          siteName: ORS.ESTABLISHED.name,
          siteAddress: `${ORS.ESTABLISHED.address}, ${ORS.ESTABLISHED.town}`,
          addressLine1: ORS.ESTABLISHED.address,
          addressLine2: ORS.ESTABLISHED.addressLine2,
          townOrCity: ORS.ESTABLISHED.town,
          country: ORS.ESTABLISHED.country,
          coordinates: ORS.ESTABLISHED.coordinates,
          contactName: ORS.ESTABLISHED.contactName,
          contactEmail: ORS.ESTABLISHED.contactEmail,
          contactPhone: ORS.ESTABLISHED.contactPhone,
          operationCode: ORS.ESTABLISHED.operationCode,
          operationCodes: ORS.ESTABLISHED.operationCodes,
          code1: ORS.ESTABLISHED.wasteCodes[0],
          code2: ORS.ESTABLISHED.wasteCodes[1],
          code3: ORS.ESTABLISHED.wasteCodes[2],
          repatriatedLoads: ORS.ESTABLISHED.repatriatedLoads,
          conditionsOfExport: false,
          isEu: true,
          isOecd: true,
          isNewSite: false,
          registeredNowAccredited: true,
          besEvidence: { files: [] },
          interimSite: {
            siteId: 21,
            siteNumber: INTERIM.ESTABLISHED.siteNumber,
            isNewSite: false,
            country: INTERIM.ESTABLISHED.country,
            siteName: INTERIM.ESTABLISHED.name,
            addressLine1: INTERIM.ESTABLISHED.address,
            townOrCity: INTERIM.ESTABLISHED.town,
            stateOrRegion: 'Bremen',
            postcode: '28217',
            contactName: INTERIM.ESTABLISHED.contactName,
            contactEmail: INTERIM.ESTABLISHED.contactEmail,
            contactPhone: INTERIM.ESTABLISHED.contactPhone,
            // A bare string rather than an array, as a real payload can carry.
            operationCodes: INTERIM.ESTABLISHED.operationCode
          }
        },
        {
          siteId: ORS.LEGACY.siteId,
          orsId: ORS.LEGACY.orsId,
          siteName: ORS.LEGACY.name,
          siteAddress: `${ORS.LEGACY.address}, ${ORS.LEGACY.town}`,
          townOrCity: ORS.LEGACY.town,
          country: ORS.LEGACY.country
        },
        {
          siteId: ORS.NON_EU.siteId,
          orsId: ORS.NON_EU.orsId,
          siteName: ORS.NON_EU.name,
          siteAddress: `${ORS.NON_EU.address}, ${ORS.NON_EU.town}`,
          addressLine1: ORS.NON_EU.address,
          addressLine2: ORS.NON_EU.addressLine2,
          townOrCity: ORS.NON_EU.town,
          country: ORS.NON_EU.country,
          coordinates: ORS.NON_EU.coordinates,
          contactName: ORS.NON_EU.contactName,
          contactEmail: ORS.NON_EU.contactEmail,
          contactPhone: ORS.NON_EU.contactPhone,
          operationCode: ORS.NON_EU.operationCode,
          operationCodes: ORS.NON_EU.operationCodes,
          code1: ORS.NON_EU.wasteCodes[0],
          code2: ORS.NON_EU.wasteCodes[1],
          code3: ORS.NON_EU.wasteCodes[2],
          repatriatedLoads: ORS.NON_EU.repatriatedLoads,
          isEu: false,
          isOecd: false,
          isNewSite: false,
          registeredNowAccredited: false,
          besEvidence: { files: [] }
        }
      ]
    }
  }
}

/** Submit a new RA-292 item; returns what `createWorkItemViaApi` returns. */
export async function createOrsInterimAuthorityWorkItem() {
  return createWorkItemViaApi({
    organisationNamePrefix: 'Overseas Reprocessing Verification Ltd',
    fields: await orsInterimAuthorityFields()
  })
}
