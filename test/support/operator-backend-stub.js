/**
 * epr-p86e — driving the operator-journey (OJ) backend stand-in.
 *
 * The decision is atomic and OJ-gated: management-be pushes the status change
 * to the OJ backend and only completes the transition once that push is
 * acknowledged (200). The real OJ backend is not in this compose stack, so the
 * push is answered by the lightweight `operator-backend-stub` service (see
 * docker/stubs/operator-backend-stub.mjs and compose.yml). It returns 200 by
 * default; the failure-path spec ARMS a single work-item id to get a 500,
 * exercising the "OJ unreachable" branch without breaking every other decision.
 *
 * These helpers talk to the stub's control plane, which — like
 * `MANAGEMENT_BE_URL` in query-resubmission.js — is reached from the TEST
 * RUNNER (a host Node process in every configuration, the compose run
 * included), NOT from the browser. compose.yml publishes the stub's port
 * (default 8090 -> container 8080) for exactly this reason. The be container
 * reaches the same process by service name, so an arm set here is seen by the
 * push that be makes.
 */

export const OPERATOR_BACKEND_STUB_URL =
  process.env.OPERATOR_BACKEND_STUB_URL ?? 'http://localhost:8090'

async function control(method, path) {
  const res = await fetch(`${OPERATOR_BACKEND_STUB_URL}${path}`, {
    method,
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) {
    throw new Error(
      `operator-backend stub control ${method} ${path} returned ${res.status}`
    )
  }
  return res
}

/**
 * Arm the stub so the NEXT OJ push for `workItemId` is answered with a 500.
 * Call this BEFORE submitting that item's decision.
 */
export function armDecisionFailure(workItemId) {
  return control('POST', `/__control/fail/${encodeURIComponent(workItemId)}`)
}

/** Clear a previously armed failure for `workItemId`. */
export function clearDecisionFailure(workItemId) {
  return control('DELETE', `/__control/fail/${encodeURIComponent(workItemId)}`)
}

/** Clear every armed failure — belt-and-braces teardown for a spec. */
export function resetOperatorBackendStub() {
  return control('POST', '/__control/reset')
}
