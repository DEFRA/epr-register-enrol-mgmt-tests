/**
 * RA-412 seed fixture.
 *
 * OWNED BY management-be, not by this suite — seeded by
 * `ReAccreditationSeeder` (seed key `GlobalGlassExportsSeedKey` =
 * "global-glass-exports", management-be#118): a genuine Exporter
 * application (org 50006 in the ticket's own example) with
 * `payload.wasteProcessingType: "exporter"`. Its organisation name is
 * deliberately unique across the seed set specifically so a search by
 * organisation name resolves to exactly one row — the same discipline as
 * `ra-292-seed.js`'s `ORG_NAME`, which this module otherwise mirrors.
 *
 * The seeder inserts via CreateIfAbsentAsync keyed on a deterministic id, so
 * this item appears on the next backend boot even against a mongo volume
 * that has already been seeded.
 *
 * If either value below stops resolving a unique card, the seed data
 * changed: fix it here, not in the spec.
 */

export const GLOBAL_GLASS_EXPORTS_ORG_NAME = 'Global Glass Exports'

/**
 * The seeded item's raw `payload.material` is the token `glass`, which
 * management-fe's `materials.js` always renders as the single label
 * "Glass" — the operator backend's `MaterialType` enum has no remelt/other
 * distinction, so this token can never resolve to anything else.
 */
export const GLOBAL_GLASS_EXPORTS_MATERIAL_LABEL = 'Glass'
