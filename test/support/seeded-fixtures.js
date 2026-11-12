import {
  CASEWORKER_USER,
  expectStatus,
  managementBeRequest
} from './backend-api.js'

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
 * `incorrectAccreditationId` to it. management-be builds that entry with the
 * migration's own audit-entry factory, so its shape is what the migration
 * writes. The references are fixture values, not the two production ones.
 */
export const ACCREDITATION_CORRECTED_WORK_ITEM = {
  id: '00000691-0000-4000-8000-000000000691',
  incorrectAccreditationId: 'A27ER9006910322PL',
  correctedAccreditationId: 'A27ER9006910246PL'
}

/**
 * RA-764: an unassigned `submitted` ("Not started") 2027 renewal for
 * organisation 500069, seeded under its old name `previousOrganisationName`
 * with no audit log. Unlike the items above it is seeded PRE-change: on the
 * compose stack management-be's one-off organisation-name migration is
 * enabled (docker/config/management-be.env) and runs after the fixture reset
 * on every start, so the item the suite sees carries `organisationName`.
 * Where that migration is not enabled (CDP test) it still shows the old name;
 * see `isOrganisationNameMigrationEnabled()`.
 *
 * The real organisation and registration numbers, because the migration is
 * keyed to them. Nothing else this suite seeds or creates carries either
 * name, so a search for either finds this item or nothing.
 */
export const ORGANISATION_RENAMED_WORK_ITEM = {
  id: '00000764-0000-4000-8000-000000000764',
  applicationReference: 'RA-900000764',
  organisationId: '500069',
  registrationNumber: 'R26NR5000690003GL',
  previousOrganisationName: 'Encirc Ltd',
  organisationName: 'VIDRALA UK & IRELAND LIMITED',
  status: 'Not started',
  stateId: 'submitted'
}

/**
 * RA-764. Whether management-be's organisation-name migration ran on the
 * stack under test. True on the compose stack (wdio.github.conf.js), which
 * enables it; unset on CDP test, which never does.
 */
export const isOrganisationNameMigrationEnabled = () =>
  process.env.RA764_ORGANISATION_NAME_MIGRATION_ENABLED === 'true'

/**
 * RA-764, MERGE WINDOW ONLY. Whether the running management-be seeds
 * `ORGANISATION_RENAMED_WORK_ITEM` at all. Until management-be's RA-764
 * change is in the `latest` image, the compose stack's management-be (used
 * by every repo whose branch has no matching management-be branch) has no
 * such item, and the spec would fail on a fixture that cannot exist yet.
 *
 * True on 200, false on 404; any other status throws, so a broken stack is
 * never mistaken for an old image. Remove with the spec.
 */
export async function isOrganisationRenamedWorkItemSeeded() {
  const { id } = ORGANISATION_RENAMED_WORK_ITEM
  const result = await managementBeRequest('GET', `/work-items/${id}`, {
    user: CASEWORKER_USER
  })
  if (result.status === 404) {
    return false
  }
  expectStatus(result, 200, `GET RA-764 fixture work item ${id}`)
  return true
}
