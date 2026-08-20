/**
 * Operator-journey (OJ) backend stand-in for the journey-test compose stack.
 *
 * WHY THIS EXISTS
 * ---------------
 * management-be's decision is now atomic and OJ-gated (epr-p86e.1): before it
 * moves a re-accreditation to `approved`/`rejected` it pushes the status change
 * to the operator-journey backend and only completes the transition once that
 * push is acknowledged. That backend is `epr-register-enrol-backend`, which is
 * NOT part of this compose stack — so without something answering
 *   POST /api/v1/accreditation-applications/case-management/{id}/status
 * every decision strands the item and the happy-path specs can never go green.
 *
 * RA-448 phase 2 added a second call on the same approval path: before
 * stamping an accreditation id, management-be now asks this same backend for
 * a real one via
 *   POST /api/v1/accreditation-applications/{organisationId}/{applicationId}/accreditation-number
 * Every approve in this stack calls it, so — same as the status push above —
 * without a stub route here every approval strands the item (404 ->
 * AccreditationNumberUnavailable -> 500), not just RA-448-specific specs.
 *
 * This is the smallest thing that answers both calls. It is deliberately
 * dumb: management-be signs its push (HMAC over the CDP client-id headers)
 * but `HttpOperatorBackendPushAdapter`/`HttpAccreditationNumberAdapter` only
 * inspect the RESPONSE (status code, and for the number endpoint the
 * `accreditationReference` body field) and never verify a response
 * signature, so the stub validates nothing.
 *
 * The generated accreditation number is SYNTHETIC, not a faithful
 * reimplementation of the real backend's generator: the request body carries
 * Nation/OrgId/Year/Regenerate but never the application's material (the real
 * backend derives that from its own stored AccreditationApplicationModel,
 * which this stateless stub has no equivalent of), so the trailing
 * material-code segment cannot be computed correctly here — it is always
 * "XX", a deliberate placeholder rather than a guess. Specs asserting the
 * overall shape accept any two letters there for exactly this reason.
 *
 * The middle "sequence" segment comes from a single in-memory counter
 * incremented on every call, NOT derived from the request. management-be's
 * `payload.accreditationId` index is unique+sparse (RA-448 phase 2 kept it as
 * a defence-in-depth backstop once the real backend's own atomic counters
 * took over uniqueness), and this stack's specs mostly create work items
 * through the UI without overriding operatorOrganisationId/
 * operatorRegistrationId — so many approvals share the same
 * nation/orgId/applicationId/year and a purely request-derived value would
 * collide across them (a real 11000 duplicate-key error was how this was
 * found). One shared counter, regardless of which application is asking,
 * guarantees every value handed out this process's lifetime is unique.
 *
 * FAILURE INJECTION
 * -----------------
 * The failure-path spec needs the push to fail for ONE work item without
 * breaking every other decision in the run. management-be reads a single
 * `OperatorBackendApi__Url` for all items, so per-item behaviour cannot come
 * from config. Instead the test runner arms a specific work-item id over the
 * stub's published control port BEFORE submitting that item's decision:
 *   POST   /__control/fail/{id}   -> subsequent pushes for {id} return 500
 *   DELETE /__control/fail/{id}   -> clear it
 *   POST   /__control/reset       -> clear all
 * The be container reaches the stub by service name and the runner reaches the
 * same process over localhost, so they share one in-memory arm set. This
 * mirrors the published-port pattern `MANAGEMENT_BE_URL` already uses for
 * resume-from-query. Not wired up to the accreditation-number endpoint: no
 * spec currently exercises that failure path.
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT) || 8080

// Work-item ids whose next OJ push should be answered with a 5xx, armed by the
// test runner via the control endpoints below. In-memory and process-lifetime
// only — a fresh stack starts with nothing armed.
const failing = new Set()

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// The real OJ contract management-be pushes to (RA-368 status / RA-311 query).
// Both are answered identically here.
const PUSH_PATH =
  /^\/api\/v1\/accreditation-applications\/case-management\/([^/]+)\/(status|query)$/
// RA-448 phase 2: the accreditation-number generate/reapply call.
const NUMBER_PATH =
  /^\/api\/v1\/accreditation-applications\/([^/]+)\/([^/]+)\/accreditation-number$/
const FAIL_PATH = /^\/__control\/fail\/([^/]+)$/

// England/Scotland/Wales/Northern Ireland -> the single-letter agency code
// the real generator's format uses. Falls back to 'E' for an unrecognised or
// missing nation rather than rejecting the request — the shape of the id
// matters to the specs that read it, not agency correctness.
const NATION_LETTER = {
  England: 'E',
  Scotland: 'S',
  Wales: 'W',
  NorthernIreland: 'N'
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve({})
      }
    })
  })
}

// Module-lifetime counter — see the class doc comment for why this drives
// uniqueness instead of anything derived from the request.
let sequenceCounter = 0

// Synthetic, not a faithful reimplementation of the real backend's generator
// — see the class doc comment for why the trailing two characters are always
// the "XX" placeholder rather than a real material code, and why the
// sequence segment comes from a counter rather than the request.
function buildAccreditationReference({ nation, orgId, year }) {
  const yearSuffix = String(year ?? new Date().getFullYear()).slice(-2)
  const agency = NATION_LETTER[nation] ?? 'E'
  const orgSegment = String(orgId ?? '0')
    .padStart(6, '0')
    .slice(-6)
  sequenceCounter += 1
  const sequenceSegment = sequenceCounter
    .toString(36)
    .toUpperCase()
    .padStart(3, '0')
    .slice(-3)
  return `A${yearSuffix}${agency}R${orgSegment}${sequenceSegment}XX`
}

const server = createServer((req, res) => {
  const { method, url } = req

  // Compose healthcheck.
  if (url === '/health' && method === 'GET') {
    return send(res, 200, { status: 'ok' })
  }

  // Control plane — reachable from the host test runner on the published port.
  const failMatch = url.match(FAIL_PATH)
  if (failMatch) {
    const id = decodeURIComponent(failMatch[1])
    if (method === 'POST') {
      failing.add(id)
      return send(res, 200, { armed: id })
    }
    if (method === 'DELETE') {
      failing.delete(id)
      return send(res, 200, { cleared: id })
    }
  }
  if (url === '/__control/reset' && method === 'POST') {
    failing.clear()
    return send(res, 200, { reset: true })
  }

  // The OJ push itself.
  const pushMatch = url.match(PUSH_PATH)
  if (pushMatch && method === 'POST') {
    const id = decodeURIComponent(pushMatch[1])
    // Drain and discard the body so the socket closes cleanly; the payload is
    // never needed — only the response status is part of the contract.
    req.on('data', () => {})
    req.on('end', () => {
      if (failing.has(id)) {
        console.log(`[oj-stub] 500 (armed) ${method} ${url}`)
        return send(res, 500, { error: 'stubbed operator-backend failure' })
      }
      console.log(`[oj-stub] 200 ${method} ${url}`)
      return send(res, 200, { ok: true })
    })
    return
  }

  // RA-448 phase 2: the accreditation-number generate/reapply call.
  const numberMatch = url.match(NUMBER_PATH)
  if (numberMatch && method === 'POST') {
    readJsonBody(req).then((body) => {
      const accreditationReference = buildAccreditationReference({
        nation: body.nation,
        orgId: body.orgId,
        year: body.year
      })
      console.log(`[oj-stub] 200 ${method} ${url} -> ${accreditationReference}`)
      return send(res, 200, { accreditationReference })
    })
    return
  }

  send(res, 404, { error: 'not found', method, url })
})

server.listen(PORT, () => {
  console.log(`[oj-stub] operator-backend stand-in listening on :${PORT}`)
})
