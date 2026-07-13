import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const dist = resolve(process.cwd(), process.env.DIST_DIR ?? 'dist')
const requiredFiles = [
  'index.html',
  'manifest.webmanifest',
  'offline.css',
  'offline.html',
  'pwa-192.png',
  'pwa-512.png',
  'pwa-maskable-512.png',
  'service-worker.js'
]

const fail = (message) => {
  console.error(`PWA build verification failed: ${message}`)
  process.exitCode = 1
}

for (const file of requiredFiles) {
  if (!existsSync(join(dist, file))) fail(`missing dist/${file}`)
}

if (process.exitCode) process.exit(process.exitCode)

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'))
if (manifest.start_url !== './' || manifest.scope !== './' || manifest.display !== 'standalone') {
  fail('manifest must use portable start_url/scope and standalone display')
}

const worker = readFileSync(join(dist, 'service-worker.js'), 'utf8')
if (worker.includes('__WB_MANIFEST')) fail('precache marker was not replaced')
if (!worker.includes('creditcalc-')) fail('application cache namespace is missing')

const precacheUrls = new Set([...worker.matchAll(/"url":"([^"]+)"/g)].map(match => match[1]))
const base = process.env.VITE_BASE_PATH ?? './'
const isPagesBase = base.startsWith('/')
const scopeUrl = new URL(isPagesBase ? base : '/', 'https://pwa-build.invalid')
const resolvedPrecachePaths = new Set()
for (const url of precacheUrls) {
  if (!isPagesBase && (url.startsWith('/') || /^https?:/i.test(url))) fail(`portable build contains absolute precache URL: ${url}`)
  const resolved = new URL(url, scopeUrl)
  if (resolved.origin !== scopeUrl.origin || !resolved.pathname.startsWith(scopeUrl.pathname)) {
    fail(`precache URL escapes ${scopeUrl.pathname}: ${url}`)
  }
  resolvedPrecachePaths.add(resolved.pathname)
}

const precacheExtensions = new Set(['.css', '.html', '.js', '.png', '.svg', '.webmanifest', '.woff2'])
const visit = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name)
  return entry.isDirectory() ? visit(path) : [path]
})
const expected = visit(dist)
  .filter(path => statSync(path).isFile() && precacheExtensions.has(extname(path)) && !path.endsWith('service-worker.js'))
  .map(path => relative(dist, path).replaceAll('\\', '/'))

for (const file of expected) {
  const expectedPath = new URL(file, scopeUrl).pathname
  if (!resolvedPrecachePaths.has(expectedPath)) fail(`file is not precached: ${expectedPath}`)
}

if (![...precacheUrls].some(url => /assets\/.+-[A-Za-z0-9_-]+\.js$/.test(url))) {
  fail('hashed JavaScript assets are not present in precache')
}

if (!process.exitCode) console.log(`PWA build verified: ${precacheUrls.size} precache entries, base ${base}`)
