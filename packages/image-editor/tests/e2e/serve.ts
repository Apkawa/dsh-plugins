// Static http server shared by the playwright lanes — ES modules do not load over file://.
// The dev page loads ./dev.ts, a module only vite transforms; this lane has no vite, so it
// rewrites that URL to /dist/dev.js and drives the built browser bundle instead — the artifact
// a page actually receives. Same mapping as before: `/` -> dev/index.html, nothing outside
// dev/ + dist/ served, so any server with that mapping is interchangeable.
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = fileURLToPath(new URL('../../', import.meta.url))

export type Lane = { url: string; close: () => Promise<void> }

export function serve(): Promise<Lane> {
  return new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      const file = pathname === '/' ? 'dev/index.html' : pathname.slice(1)
      if (!file.startsWith('dev/') && !file.startsWith('dist/')) {
        response.writeHead(404)
        response.end('not found')
        return
      }
      if (!existsSync(path.join(packageDir, file))) {
        response.writeHead(404)
        response.end('not found')
        return
      }
      const body = await readFile(path.join(packageDir, file))
      response.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : 'text/javascript' })
      response.end(file === 'dev/index.html' ? body.toString('utf8').replace('./dev.ts', '/dist/dev.js') : body)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('server did not bind a TCP port')
      resolve({ url: `http://127.0.0.1:${address.port}`, close: () => new Promise((done) => server.close(() => done())) })
    })
  })
}
