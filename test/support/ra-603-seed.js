/**
 * RA-603 seed fixture map.
 *
 * These values are OWNED BY management-be, not by this suite. They are seeded by
 * `ReAccreditationSeeder` under seed key `multiple-interim-sites` and reproduced here so the spec
 * asserts against one copy rather than scattering string literals — the same reasoning as
 * `ra-292-seed.js`.
 *
 * The fixture exists to prove AC10b, so it is deliberately heterogeneous: three interim sites on
 * ONE overseas reprocessing site, differing in every dimension the page renders. A fixture whose
 * interim sites all looked alike could not tell a correct implementation from one that renders
 * the first and ignores the rest, or badges everything as new, or ignores `removedAt`.
 *
 * The seeder inserts via CreateIfAbsentAsync keyed on a deterministic id, and this is a NEW seed
 * key, so the item appears on the next backend boot even against a mongo volume that has already
 * seeded. That is the whole reason it is not simply extra interim sites bolted onto the RA-292
 * fixture, which would have been invisible everywhere except a from-scratch CI run.
 *
 * If any value below stops matching, the seeder changed: fix it here, not in the spec.
 */

/** Resolves the work-items search to this one item. */
export const ORG_NAME = 'Iberian Fibre Exports'

export const REGISTRATION_NUMBER = 'EPR-100603'

/** The single overseas reprocessing site that carries all three interim sites. */
export const ORS_NAME = 'Valencia Fibre Reprocessing'

/**
 * The two interim sites the operator has NOT withdrawn, in the order the page renders them.
 * `BILBAO` is established, `MARSEILLE` is new — both polarities on the same ORS, so the "new"
 * badge assertions compare two siblings rather than trusting one.
 */
export const ACTIVE_INTERIM_SITES = [
  {
    name: 'Bilbao Interim Holding',
    country: 'Spain',
    townOrCity: 'Bilbao',
    siteNumber: '001',
    operationCodes: ['R12'],
    isNew: false
  },
  {
    name: 'Marseille Interim Depot',
    country: 'France',
    townOrCity: 'Marseille',
    siteNumber: '002',
    operationCodes: ['R12', 'R13'],
    isNew: true
  }
]

/**
 * Withdrawn, and therefore absent from the regulator's view.
 *
 * AC05 keeps a withdrawn interim site in the record for reporting; the detail page is not where
 * that reporting happens, so a caseworker reviewing the application sees what is on it now. This
 * is the entry that makes the spec meaningful — without it, a view that ignored `removedAt`
 * entirely would pass every other assertion here.
 */
export const WITHDRAWN_INTERIM_SITE = {
  name: 'Genoa Interim Store',
  country: 'Italy',
  siteNumber: '003'
}
