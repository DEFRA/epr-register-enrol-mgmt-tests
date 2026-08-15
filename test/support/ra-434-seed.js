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
 *   - REPROCESSOR reuses the existing `full-payload-verification` seed item
 *     (org "Full Payload Verification Ltd"), which RA-434 extended with the
 *     three new fields. It carries no `wasteProcessingType`, so it also
 *     covers the "absent defaults to reprocessor" branch — every seed item
 *     predates RA-412/RA-434 except the exporter fixture below, so there is
 *     no separate "explicit reprocessor" fixture to point at.
 *   - EXPORTER is a new seed item (own seedKey `additional-information-exporter`,
 *     per the insert-only seeding rule — see README.md's "Stale seed data"
 *     section) carrying `wasteProcessingType: "exporter"` and, the point of
 *     the fixture, NO `siteAddress` at all — re-ex has no site for an
 *     exporter, so the tab's Site address row must fall back to the
 *     registered address.
 */

export const REPROCESSOR = {
  ORG_NAME: 'Full Payload Verification Ltd',
  COMPANIES_HOUSE_NUMBER: '12345678',
  COMPANY_REGISTERED_ADDRESS: '100 Registered Office Road, London, EC1A 1AB',
  // Rendered joined with the postcode by the same site-address formatting the
  // Application summary tab uses; asserted with toContain() on both
  // fragments rather than pinning the exact join, matching the precedent in
  // application-details-full-payload.e2e.js.
  SITE_ADDRESS_LINE: '1 Full Payload Lane',
  SITE_ADDRESS_POSTCODE: 'EC1A 1BB',
  // companyRegisteredAddress and siteAddress are deliberately DIFFERENT
  // values in the seed — a template that accidentally aliases the two
  // fields would otherwise pass unnoticed.
  PERMIT_NUMBERS_JOINED: 'WML999000, PPC888777'
}

export const EXPORTER = {
  ORG_NAME: 'Continental Exports Verification Ltd',
  COMPANIES_HOUSE_NUMBER: '09876543',
  COMPANY_REGISTERED_ADDRESS: '1 Continental Way, Dover, Kent',
  PERMIT_NUMBERS_JOINED: 'WML123456, PPC456789'
}
