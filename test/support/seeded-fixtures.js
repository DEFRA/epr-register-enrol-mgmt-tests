/**
 * Work items management-be seeds for the two cases no API can create.
 *
 * management-be's `ReAccreditationTestOrganisationFixtures` writes both with
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
