/**
 * RA-000. The one place the test runner talks to a backend directly.
 *
 * The suite creates its own work items (see `work-item-api.js` and
 * `operator-backend-api.js`) and plays the operator's service for the
 * operator-side transitions (resume-from-query, withdraw). Those calls are
 * made from the TEST RUNNER, a Node process, never from the browser, so they
 * use these base URLs rather than wdio's `baseUrl`:
 *
 *   MANAGEMENT_BE_URL       epr-register-enrol-management-be
 *   OPERATOR_BACKEND_URL    epr-register-enrol-backend (the operator journey)
 *   CDP_UPLOADER_URL        cdp-uploader, for fixture files (cdp-uploader.js)
 *
 * The wdio config sets both for its environment (`wdio.github.conf.js` for
 * the compose stack, `wdio.conf.js` for CDP). Every base URL and every
 * header lives in this module, so pointing the suite at a different route
 * to the same services is a change here and nowhere else.
 *
 * Authentication is applied only when its secret is set:
 *
 *   MANAGEMENT_BE_SHARED_SECRET     signs each management-be request with
 *                                   the v3 HMAC (as the
 *                                   `epr-register-enrol-mgmt-tests` caller)
 *   OPERATOR_BACKEND_SHARED_SECRET  sends `Authorization: Bearer <secret>`
 *                                   to the operator backend
 *
 * With neither set, requests go unsigned, which only a stack with no
 * secrets configured accepts.
 *
 * RA-751. One spec also plays the Admin UI (`epr-register-enrol-admin`),
 * management-be's read-only caller, to pin its route policy. That only works
 * where the suite may hold the Admin UI's secret, so it is opt-in too:
 *
 *   ADMIN_UI_CALLER_ENABLED         "true" where the spec may run: the
 *                                   compose stack (wdio.github.conf.js) and a
 *                                   local stack (wdio.local.conf.js). Unset
 *                                   on CDP, where the secret is the Admin
 *                                   UI's alone, so the spec is skipped there.
 *   ADMIN_UI_SHARED_SECRET          management-be's
 *                                   AUTH_SHARED_SECRET__ADMIN_UI. Unset on a
 *                                   local stack, whose management-be runs as
 *                                   Development with no secrets and accepts
 *                                   the requests unsigned.
 *
 * RA-527. One spec also plays management-be itself, sending a status push to
 * the operator backend as management-be does (`caseManagementPushRequest`).
 * That only works where the suite may hold management-be's own secret for
 * that backend, so it is opt-in:
 *
 *   CASE_MANAGEMENT_PUSH_ENABLED    "true" where the spec may run: the
 *                                   compose stack (wdio.github.conf.js) and a
 *                                   local stack (wdio.local.conf.js). Unset
 *                                   on CDP, where the secret is management-be's
 *                                   alone, so the spec is skipped there.
 *   CASE_MANAGEMENT_PUSH_SECRET     the operator backend's
 *                                   AUTH_SHARED_SECRET__MANAGEMENT_BE. Unset
 *                                   on a local stack, whose operator backend
 *                                   runs as Development with no secret and
 *                                   accepts the push unsigned.
 */

import { createHmac, randomBytes } from 'node:crypto'

export const MGMT_TESTS_CLIENT_ID = 'epr-register-enrol-mgmt-tests'

const REQUEST_TIMEOUT_MS = 30_000

/** The acting identity when the suite plays the operator's own service. */
export const OPERATOR_SERVICE_USER = {
  id: 'operator-service',
  name: 'Operator Service'
}

/**
 * The acting identity when the suite plays a caseworker against
 * management-be directly. Matches the stub caseworker the UI logs in as, so
 * history entries read the same either way.
 */
export const CASEWORKER_USER = {
  id: 'stub-caseworker-one',
  name: 'Stub Caseworker One'
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. The wdio config sets it for its environment; set it explicitly when running a spec some other way.`
    )
  }
  return value.replace(/\/$/, '')
}

/**
 * management-be's v3 HMAC trust-header signature, in the extended form
 * (`v3`, client id, user id, user name, role, nation, timestamp, nonce, each
 * on its own line). A header the request does not send (the mgmt-tests
 * caller and the Admin UI send no nation, and the mgmt-tests caller usually
 * no role) is signed as an empty string. Mirrors management-fe's
 * `src/server/common/helpers/backend-api/sign-request.js`.
 *
 * Returns no headers when `sharedSecret` is unset.
 */
export function signManagementBeHeaders(
  headers,
  {
    sharedSecret,
    timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    nonce = randomBytes(16).toString('base64url')
  } = {}
) {
  if (!sharedSecret) {
    return {}
  }
  const canonical = [
    'v3',
    headers['x-cdp-client-id'] ?? '',
    headers['x-cdp-user-id'] ?? '',
    headers['x-cdp-user-name'] ?? '',
    headers['x-cdp-user-role'] ?? '',
    headers['x-cdp-user-nation'] ?? '',
    timestamp,
    nonce
  ].join('\n')
  const signature = createHmac('sha256', sharedSecret)
    .update(canonical, 'utf8')
    .digest('base64')
  return {
    'x-cdp-auth-timestamp': timestamp,
    'x-cdp-auth-nonce': nonce,
    'x-cdp-auth-signature': signature
  }
}

async function send(url, { method, headers, body }) {
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  // ProblemDetails on failure, a resource on success, and no body at all on
  // a 401 from an auth handler. Read defensively so a parse failure never
  // masks the status the caller needs to see.
  let payload = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }
  return { status: res.status, headers: res.headers, body: payload }
}

/**
 * Call management-be as the `epr-register-enrol-mgmt-tests` caller, acting
 * as `user`.
 */
export function managementBeRequest(
  method,
  path,
  { body, user = OPERATOR_SERVICE_USER } = {}
) {
  return signedManagementBeRequest(method, path, {
    clientId: MGMT_TESTS_CLIENT_ID,
    sharedSecret: process.env.MANAGEMENT_BE_SHARED_SECRET,
    user,
    body
  })
}

/** RA-751. The client id the Admin UI signs its management-be calls with. */
const ADMIN_UI_CLIENT_ID = 'epr-register-enrol-admin'

/**
 * RA-751. The acting identity when the suite plays the Admin UI: a support
 * user with the role the Admin UI requires and sends with every call
 * (its `auth.requiredRole`). Like the Admin UI it sends no nation, so the
 * signed payload has the role line and an empty nation line (ADR-0010).
 */
const ADMIN_UI_USER = {
  id: 'stub-admin-support-user',
  name: 'Stub Admin Support User',
  role: 'Waste.SupportUser.ReadOnly'
}

/** RA-751. Whether this run may play the Admin UI (see the module doc). */
export const isAdminUiCallerEnabled = () =>
  process.env.ADMIN_UI_CALLER_ENABLED === 'true'

/**
 * RA-751. Call management-be AS the Admin UI, signed with
 * `ADMIN_UI_SHARED_SECRET` (or, by passing `sharedSecret`, with some other
 * secret, to prove a wrong one is refused). `userName` replaces the acting
 * user's name. As the Admin UI does, the name is sent (and signed) as
 * `encodeURIComponent(name.trim())`, so a name outside ASCII is a valid
 * header; management-be checks the header as received.
 *
 * `role` and `nation` replace the role the Admin UI sends and add a nation
 * it never sends. Only to prove a refusal is the read-only gate's: a write
 * whose handler checks the caller's role and nation is sent with the ones a
 * caseworker would succeed with, so the handler's own 403 is ruled out.
 *
 * Only for runs where `isAdminUiCallerEnabled()`; it throws otherwise, so a
 * spec that forgot the gate fails loudly rather than with a puzzling 401.
 */
export function adminUiRequest(
  method,
  path,
  {
    body,
    sharedSecret = process.env.ADMIN_UI_SHARED_SECRET,
    userName = ADMIN_UI_USER.name,
    role = ADMIN_UI_USER.role,
    nation
  } = {}
) {
  if (!isAdminUiCallerEnabled()) {
    throw new Error(
      'ADMIN_UI_CALLER_ENABLED is not "true": this run may not play the Admin UI.'
    )
  }
  return signedManagementBeRequest(method, path, {
    clientId: ADMIN_UI_CLIENT_ID,
    sharedSecret,
    user: {
      ...ADMIN_UI_USER,
      name: encodeURIComponent(userName.trim()),
      role,
      nation
    },
    body
  })
}

/**
 * Call management-be as `clientId`, acting as `user` (with its role and
 * nation headers when `user.role` and `user.nation` are set), signed with
 * `sharedSecret` when it is set. A fresh nonce and signature are minted for
 * every request, so a retry is always a new, validly signed request.
 */
function signedManagementBeRequest(
  method,
  path,
  { clientId, sharedSecret, user, body }
) {
  const headers = {
    accept: 'application/json',
    'x-cdp-client-id': clientId,
    'x-cdp-user-id': user.id,
    'x-cdp-user-name': user.name
  }
  if (user.role) {
    headers['x-cdp-user-role'] = user.role
  }
  if (user.nation) {
    headers['x-cdp-user-nation'] = user.nation
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  return send(`${requireEnv('MANAGEMENT_BE_URL')}${path}`, {
    method,
    headers: {
      ...headers,
      ...signManagementBeHeaders(headers, { sharedSecret })
    },
    body
  })
}

/** Call the operator journey backend, with a Bearer when its secret is set. */
export function operatorBackendRequest(method, path, { body } = {}) {
  const headers = { accept: 'application/json' }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  const secret = process.env.OPERATOR_BACKEND_SHARED_SECRET
  if (secret) {
    headers.authorization = `Bearer ${secret}`
  }
  return send(`${requireEnv('OPERATOR_BACKEND_URL')}${path}`, {
    method,
    headers,
    body
  })
}

/** The client id management-be signs its operator-backend pushes with. */
export const MANAGEMENT_BE_CLIENT_ID = 'epr-register-enrol-management-be'

/** RA-527. Whether this run may play management-be (see the module doc). */
export const isCaseManagementPushEnabled = () =>
  process.env.CASE_MANAGEMENT_PUSH_ENABLED === 'true'

/**
 * The v3 HMAC the operator backend's CaseManagement auth handler checks:
 * `v3`, client id, user id, user name, timestamp and nonce, each on its own
 * line. Unlike management-be's own scheme there is no role or nation line,
 * and management-be sends no user, so both user lines are empty. Mirrors
 * management-be's `HttpOperatorBackendPushAdapter.BuildRequest`, including
 * its second-precision timestamp.
 *
 * Returns no headers when `sharedSecret` is unset.
 */
export function signCaseManagementPushHeaders({
  sharedSecret = process.env.CASE_MANAGEMENT_PUSH_SECRET,
  timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  nonce = randomBytes(16).toString('base64')
} = {}) {
  if (!sharedSecret) {
    return {}
  }
  const canonical = [
    'v3',
    MANAGEMENT_BE_CLIENT_ID,
    '',
    '',
    timestamp,
    nonce
  ].join('\n')
  const signature = createHmac('sha256', sharedSecret)
    .update(canonical, 'utf8')
    .digest('base64')
  return {
    'x-cdp-auth-signature': signature,
    'x-cdp-auth-timestamp': timestamp,
    'x-cdp-auth-nonce': nonce
  }
}

/**
 * RA-527. Call the operator backend AS management-be, signed as its pushes
 * are. Only for runs where `isCaseManagementPushEnabled()`; it throws
 * otherwise, so a spec that forgot the gate fails loudly rather than with a
 * puzzling 401.
 */
export function caseManagementPushRequest(method, path, { body } = {}) {
  if (!isCaseManagementPushEnabled()) {
    throw new Error(
      'CASE_MANAGEMENT_PUSH_ENABLED is not "true": this run may not play management-be.'
    )
  }
  const headers = {
    accept: 'application/json',
    'x-cdp-client-id': MANAGEMENT_BE_CLIENT_ID,
    ...signCaseManagementPushHeaders()
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  return send(`${requireEnv('OPERATOR_BACKEND_URL')}${path}`, {
    method,
    headers,
    body
  })
}

/**
 * Call cdp-uploader. It authenticates nothing (it is a platform service the
 * operator journey reaches directly), so only the base URL comes from here.
 * `path` may also be an absolute URL cdp-uploader returned. `body` is sent
 * as-is (e.g. FormData) unless it is a plain object, which is sent as JSON.
 */
export async function cdpUploaderRequest(method, path, { body } = {}) {
  const url = new URL(path, `${requireEnv('CDP_UPLOADER_URL')}/`)
  const isJson =
    body !== undefined && Object.getPrototypeOf(body) === Object.prototype
  const res = await fetch(url, {
    method,
    headers: isJson ? { 'content-type': 'application/json' } : {},
    body: isJson ? JSON.stringify(body) : body,
    // The upload answers with a redirect to `redirect`, which is not a page
    // the runner needs to follow.
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  let payload = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }
  return { status: res.status, headers: res.headers, body: payload }
}

/**
 * Throw unless `result.status` is one of `expected`, naming the call, so a
 * fixture that failed to build fails there and not several assertions later.
 */
export function expectStatus(result, expected, description) {
  const allowed = [].concat(expected)
  if (!allowed.includes(result.status)) {
    throw new Error(
      `${description} returned ${result.status}: ${JSON.stringify(result.body)}`
    )
  }
  return result
}
