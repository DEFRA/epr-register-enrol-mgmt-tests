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
 *       Registration & Accreditation service backend.
 *
 * On CDP none of these exist, so those specs are skipped rather than failed.
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
