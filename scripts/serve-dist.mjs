import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, relative, isAbsolute } from 'node:path'

const root = resolve(process.cwd(), process.env.DIST_DIR ?? 'dist')
const DEFAULT_E2E_PORT = 4318
const HTTP_NOT_FOUND = 404
const HTTP_OK = 200
const port = Number(process.env.E2E_DIST_PORT ?? process.env.PORT ?? DEFAULT_E2E_PORT)
const host = process.env.E2E_DIST_HOST ?? '127.0.0.1'

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8']
])

const isInsideRoot = (filePath) => {
  const pathFromRoot = relative(root, filePath)
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
}

const withoutFirstSegment = (pathname) => {
  const segments = pathname.split('/').filter(Boolean)
  return segments.length > 1 ? `/${segments.slice(1).join('/')}` : '/'
}

const fileCandidate = (pathname) => {
  const target = resolve(root, `.${pathname}`)
  if (!isInsideRoot(target) || !existsSync(target)) return null
  const stat = statSync(target)
  if (stat.isFile()) return target
  if (stat.isDirectory()) {
    const indexFile = join(target, 'index.html')
    if (existsSync(indexFile) && statSync(indexFile).isFile()) return indexFile
  }
  return null
}

const resolveRequest = (requestUrl) => {
  const url = new URL(requestUrl ?? '/', `http://${host}:${port}`)
  const pathname = decodeURIComponent(url.pathname)
  return fileCandidate(pathname) ?? fileCandidate(withoutFirstSegment(pathname)) ?? join(root, 'index.html')
}

const server = createServer((request, response) => {
  const filePath = resolveRequest(request.url)
  if (!isInsideRoot(filePath) || !existsSync(filePath)) {
    response.writeHead(HTTP_NOT_FOUND)
    response.end('Not found')
    return
  }

  response.writeHead(HTTP_OK, {
    'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
    'Cache-Control': 'no-store'
  })
  createReadStream(filePath).pipe(response)
})

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}/`)
})

const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
