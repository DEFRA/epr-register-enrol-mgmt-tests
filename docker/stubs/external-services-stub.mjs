/**
 * Stand-ins for what sits outside this stack on CDP test: ReEx, and the
 * outbound proxy the backends reach it through. The backends run with their
 * real HTTP clients, so the stack exercises the same code paths as CDP test.
 *
 * ReEx (REEX_PORT, default 8081)
 *   Answers 404 to every request, which is what real ReEx returns for the
 *   random organisations this suite creates. Anything the backends must find
 *   in ReEx comes from an `e2e-` test organisation, which the backends answer
 *   from their own stubs instead (TestOrganisations__Enabled).
 *
 * Outbound proxy (PROXY_PORT, default 3128)
 *   Stands in for CDP's Squid proxy. In Production the backends refuse to
 *   start without HTTP_PROXY/HTTPS_PROXY, and send their outbound HTTP
 *   through it. Forwards plain-HTTP requests (absolute-form) and tunnels
 *   CONNECT, to any host on the compose network.
 *
 * `GET /health` on the ReEx port answers 200 for the compose healthcheck.
 */

import { createServer, request } from 'node:http'
import { connect } from 'node:net'

const REEX_PORT = Number(process.env.REEX_PORT) || 8081
const PROXY_PORT = Number(process.env.PROXY_PORT) || 3128

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { status: 'ok' })
  }
  return send(res, 404, { message: 'Not found' })
}).listen(REEX_PORT)

const proxy = createServer((req, res) => {
  let target
  try {
    target = new URL(req.url)
  } catch {
    return send(res, 400, { message: 'Proxy requests must be absolute-form' })
  }
  const upstream = request(
    target,
    { method: req.method, headers: req.headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers)
      upstreamRes.pipe(res)
    }
  )
  upstream.on('error', () => send(res, 502, { message: 'Bad gateway' }))
  req.pipe(upstream)
})
proxy.on('connect', (req, clientSocket, head) => {
  const [host, port] = req.url.split(':')
  const upstream = connect(Number(port) || 443, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on('error', () => clientSocket.destroy())
  clientSocket.on('error', () => upstream.destroy())
})
proxy.listen(PROXY_PORT)
