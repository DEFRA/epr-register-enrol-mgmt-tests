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
 * This is the smallest thing that answers that call. It is deliberately dumb:
 * management-be signs its push (HMAC over the CDP client-id headers) but
 * `HttpOperatorBackendPushAdapter` only inspects the RESPONSE STATUS CODE and
 * never verifies a response signature, so the stub validates nothing and just
 * returns 200. That is the whole contract on the happy path.
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
 * resume-from-query.
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
const FAIL_PATH = /^\/__control\/fail\/([^/]+)$/

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

  send(res, 404, { error: 'not found', method, url })
})

server.listen(PORT, () => {
  console.log(`[oj-stub] operator-backend stand-in listening on :${PORT}`)
})
