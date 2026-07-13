export interface PrecacheEntry {
  url: string
  revision?: string | null
}

export const CACHE_PREFIX = 'creditcalc-'

const fnv1a = (value: string) => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export const buildCacheNamespace = (scopePath: string) =>
  `${CACHE_PREFIX}${fnv1a(scopePath)}-`

export const buildCacheNames = (entries: PrecacheEntry[], scopePath: string) => {
  const stableEntries = [...entries]
    .map(entry => ({ url: entry.url, revision: entry.revision ?? null }))
    .sort((left, right) => left.url.localeCompare(right.url))
  const buildId = fnv1a(JSON.stringify(stableEntries))
  const namespace = buildCacheNamespace(scopePath)
  return {
    namespace,
    static: `${namespace}static-${buildId}`,
    pages: `${namespace}pages-${buildId}`
  }
}

export const normalizedScopePath = (scope: string) => {
  const pathname = new URL(scope).pathname
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

export const isPathInsideScope = (pathname: string, scopePath: string) =>
  pathname.startsWith(scopePath)

export const isAppEntryPath = (pathname: string, scopePath: string) =>
  pathname === scopePath || pathname === `${scopePath}index.html`
