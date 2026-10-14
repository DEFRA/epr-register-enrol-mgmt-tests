/**
 * RA-000. Whether this run is against the docker-compose test stack, and the
 * gate for specs that can only pass there.
 *
 * Some specs depend on things that exist only in the compose stack:
 *
 *   (a) seeded fixtures: management-be's `ReAccreditationSeeder` items, which
 *       it seeds only on a Development host with `WorkItems:SeedOnStartup`,
 *       and the legacy item this repo's compose Mongo init script inserts;
 *   (b) direct calls to management-be at MANAGEMENT_BE_URL (the simulated
 *       operator resubmission and withdrawal in query-resubmission.js and
 *       operator-withdrawal.js), which is not reachable from a CDP run;
 *   (c) the operator backend stub at OPERATOR_BACKEND_STUB_URL
 *       (operator-backend-stub.js), which compose wires in place of the real
 *       Registration & Accreditation service backend;
 *   (d) compose's Notify configuration (docker/config/management-be.env):
 *       Notify on, every trigger on, and a regulator mailbox for England
 *       only. The notification audit entries the specs assert differ on CDP:
 *       perf-test leaves Notify off, so no entries are written at all; test
 *       turns the OfficerAssignment, OperatorApplicationSubmission,
 *       ApplicationWithdrawn and QueryResponse triggers off; and every CDP env
 *       routes all four nations to a mailbox, so the missing-regulator-mailbox
 *       skip never happens there;
 *   (e) a logged decision (approve / refuse). management-be gates the decision
 *       on the Registration & Accreditation service status push (and, for an
 *       approval, its accreditation number) before writing anything. The
 *       compose stub answers both; the real service on CDP has no
 *       application for a work item created through Case Management's create
 *       form, so the decision is abandoned and the item stays in
 *       assessment-in-progress.
 *
 * On CDP (a) to (c) don't exist and (d) and (e) behave differently, so those
 * specs are skipped rather than failed.
 * wdio.github.conf.js (the compose run) sets COMPOSE_STACK=true; anything
 * else, CDP included, leaves it unset and the gated specs report skipped.
 */
export const isComposeStack = () => process.env.COMPOSE_STACK === 'true'

/** `describe` on the compose stack, `describe.skip` everywhere else. */
export function describeOnComposeStack(title, fn) {
  return (isComposeStack() ? describe : describe.skip)(title, fn)
}

/** `it` on the compose stack, `it.skip` everywhere else. */
export function itOnComposeStack(title, fn) {
  return (isComposeStack() ? it : it.skip)(title, fn)
}
