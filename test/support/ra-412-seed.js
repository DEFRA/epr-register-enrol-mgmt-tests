/**
 * RA-412 seed fixtures.
 *
 * These organisations are OWNED BY management-be, not by this suite —
 * `FakeOrganisationPersistence.cs` flags them `wasteProcessingType: "exporter"`
 * and a submitted work item exists against each, carrying that value in its
 * payload (written by `HttpCaseWorkingApiAdapter.BuildPayload` since RA-314).
 * Reproduced here so the RA-412 spec asserts against one copy rather than a
 * hand-copied string literal — the same reasoning behind `ra-292-seed.js`.
 *
 * If either value below stops resolving a unique card, the seed data changed:
 * fix it here, not in the spec.
 */

/** Org 50006 — the ticket's primary example. */
export const GLOBAL_GLASS_EXPORTS = {
  orgId: '50006',
  orgName: 'Global Glass Exports',
  applicationReference: 'AP27EA500064DJGL'
}

/** Org 50005 — a second genuine Exporter org, for cross-checking. */
export const EXPORT_PLASTICS_LTD = {
  orgId: '50005',
  orgName: 'Export Plastics Ltd'
}
