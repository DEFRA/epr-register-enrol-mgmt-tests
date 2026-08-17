/**
 * RA-434 seed fixture map — the two work items the "Additional information"
 * tab spec asserts against.
 *
 * These values are OWNED BY management-be (`ReAccreditationSeeder`), not by
 * this suite, and are reproduced here so the spec compares against one copy
 * rather than a hand-copied literal — the same reasoning behind
 * `ra-292-seed.js` and `CASE_HEADER_FIELDS`.
 *
 * Two fixtures, covering the tab's one real conditional (the Site address
 * row's reprocessor/exporter fallback):
 *
 *   - REPROCESSOR has its own seed item, seedKey
 *     `additional-information-reprocessor` (org "Thames Reprocessing
 *     Verification Ltd"), which carries NO `wasteProcessingType` at all —
 *     RA-434-processortype's whole point is the "absent defaults to
 *     reprocessor" branch, so the fixture proving it must genuinely lack the
 *     field. This used to reuse `full-payload-verification` on the strength
 *     of THAT seed predating `wasteProcessingType` too, but
 *     RA-434-processortype gave it an explicit `wasteProcessingType:
 *     "exporter"` for its own BES/ORS fixture (management-fe now gates
 *     those sections on the real field, not on `overseasSites` presence),
 *     which removed the one seed item that had genuinely never set it.
 *   - EXPORTER is a separate seed item (own seedKey `additional-information-exporter`,
 *     per the insert-only seeding rule — see README.md's "Stale seed data"
 *     section) carrying `wasteProcessingType: "exporter"` and, the point of
 *     the fixture, NO `siteAddress` at all — re-ex has no site for an
 *     exporter, so the tab's Site address row must fall back to the
 *     registered address.
 */

export const REPROCESSOR = {
  ORG_NAME: 'Thames Reprocessing Verification Ltd',
  COMPANIES_HOUSE_NUMBER: '13579246',
  COMPANY_REGISTERED_ADDRESS: '200 Registered Office Road, London, SE1 9AA',
  // Rendered joined with the postcode by the same site-address formatting the
  // Application summary tab uses; asserted with toContain() on both
  // fragments rather than pinning the exact join, matching the precedent in
  // application-details-full-payload.e2e.js.
  SITE_ADDRESS_LINE: '1 Thames Reprocessing Way',
  SITE_ADDRESS_POSTCODE: 'SE1 9GF',
  // companyRegisteredAddress and siteAddress are deliberately DIFFERENT
  // values in the seed — a template that accidentally aliases the two
  // fields would otherwise pass unnoticed.
  PERMIT_NUMBERS_JOINED: 'WML135792, PPC468024'
}

export const EXPORTER = {
  ORG_NAME: 'Continental Exports Verification Ltd',
  COMPANIES_HOUSE_NUMBER: '09876543',
  COMPANY_REGISTERED_ADDRESS: '1 Continental Way, Dover, Kent',
  PERMIT_NUMBERS_JOINED: 'WML123456, PPC456789'
}
