/**
 * Work items management-be seeds for the cases no API can create.
 *
 * management-be's `ReAccreditationTestOrganisationFixtures` writes each with
 * these fixed ids, and REPLACES each whole document (state, assignment, SLA
 * clock with any extension or override, audit log, version) every time
 * management-be starts, whenever `TestOrganisations__Enabled=true` outside
 * prod or the Development seeder runs. Between restarts they keep whatever the
 * last run did to them, so a spec using one must leave it re-usable and must
 * not assume the pristine state beyond what the reset guarantees.
 *
 * Open them by id. Their organisation names are not unique on a Development
 * stack, whose demo seeder has similarly named items.
 */

/**
 * RA-342: a `submitted` item whose frozen `templateSnapshot` carries elements
 * the current model no longer declares (`retiredSnapshotField`, a state
 * `colour`, a transition's `requiredRoles`, a task's `mandatory`). Written as
 * raw BSON, never through the C# model.
 */
export const LEGACY_SNAPSHOT_WORK_ITEM = {
  id: '00000342-0000-4000-8000-000000000342',
  operatorOrganisationId: 'e2e-ra342-legacy-snapshot'
}

/**
 * RA-611: an unassigned `assessment-in-progress` item whose SLA clock started
 * on 14 November of the year before management-be last started, so its
 * duly-made anchor is always before 1 January of the current year.
 */
export const PRE_YEAR_START_WORK_ITEM = {
  id: '00000611-0000-4000-8000-000000000611'
}

/**
 * RA-691: an `approved` item whose accreditation reference has already been
 * corrected — `payload.accreditationId` holds `correctedAccreditationId`, and
 * its audit log holds one `accreditation-number-corrected` entry from
 * `incorrectAccreditationId` to it. The RA-691 migration that wrote these
 * entries on prod ran once on 2026-11-02 and was removed afterwards; the
 * entries it wrote are permanent. management-be's
 * `ReAccreditationTestOrganisationFixtures` seeds this item's entry with the
 * same fields the migration wrote. The references are fixture values, not the
 * three production ones.
 */
export const ACCREDITATION_CORRECTED_WORK_ITEM = {
  id: '00000691-0000-4000-8000-000000000691',
  incorrectAccreditationId: 'A27ER9006910322PL',
  correctedAccreditationId: 'A27ER9006910246PL'
}

/**
 * RA-764: organisation 500069's two unassigned `submitted` ("Not started")
 * 2027 renewals, one per registration it holds: the Northern Ireland (NIEA)
 * one and the England (EA) one. Both are seeded under the old name
 * `previousOrganisationName` with no audit log. Unlike the items above they
 * are seeded PRE-change: on the compose stack management-be's one-off
 * organisation-name migration is enabled (docker/config/management-be.env)
 * and runs after the fixture reset on every start, so the items the suite
 * sees carry `organisationName`. Where that migration is not enabled (CDP
 * test) they still show the old name; see
 * `isOrganisationNameMigrationEnabled()`.
 *
 * The real organisation and registration numbers, because the migration is
 * keyed to them. Nothing else this suite seeds or creates carries either
 * name, so a search for either finds these two items or nothing.
 */
const ORGANISATION_RENAMED_COMMON = {
  organisationId: '500069',
  previousOrganisationName: 'Encirc Ltd',
  organisationName: 'VIDRALA UK & IRELAND LIMITED',
  status: 'Not started',
  stateId: 'submitted'
}

export const ORGANISATION_RENAMED_WORK_ITEMS = [
  {
    ...ORGANISATION_RENAMED_COMMON,
    id: '00000764-0000-4000-8000-000000000764',
    applicationReference: 'RA-900000764',
    registrationNumber: 'R26NR5000690003GR',
    regulator: 'NIEA'
  },
  {
    ...ORGANISATION_RENAMED_COMMON,
    id: '00000764-0000-4000-8000-000000000765',
    applicationReference: 'RA-900000765',
    registrationNumber: 'R26ER5002260055GR',
    regulator: 'EA'
  }
]

/**
 * RA-764. Whether management-be's organisation-name migration ran on the
 * stack under test. True on the compose stack (wdio.github.conf.js), which
 * enables it; unset on CDP test, which never does.
 */
export const isOrganisationNameMigrationEnabled = () =>
  process.env.RA764_ORGANISATION_NAME_MIGRATION_ENABLED === 'true'
