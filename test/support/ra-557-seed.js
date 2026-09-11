/**
 * RA-557 seed fixture.
 *
 * OWNED BY management-be, not by this suite — seeded by
 * `ReAccreditationSeeder` (seed key `Ra557OverseasSitesResubmitSeedKey` =
 * "ra557-overseas-sites-resubmit"): a genuine Exporter application,
 * `submitted`, carrying no overseas-sites data of its own. Its organisation
 * name is deliberately unique across the seed set so a search resolves to
 * exactly one row — the same discipline as `ra-412-seed.js`'s
 * `GLOBAL_GLASS_EXPORTS_ORG_NAME`.
 *
 * PRIVATE to the RA-557 spec, unlike the RA-412 fixture: this item's whole
 * point is to be driven through real query/resubmit state transitions
 * (submitted -> queried -> updated -> duly-made -> queried -> updated), so
 * no other spec may read or assert against it — that mutation is exactly
 * why RA-557 needed its own fixture rather than reusing
 * global-glass-exports.
 *
 * The seeder inserts via CreateIfAbsentAsync keyed on a deterministic id, so
 * this item appears on the next backend boot even against a mongo volume
 * that has already been seeded.
 *
 * If the value below stops resolving a unique card, the seed data changed:
 * fix it here, not in the spec.
 */

export const RA557_OVERSEAS_SITES_RESUBMIT_ORG_NAME =
  'RA-557 Overseas Sites Resubmit Ltd'
