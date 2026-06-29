import changelogMarkdown from '../CHANGELOG.md?raw'

export const APP_VERSION = __APP_VERSION__
export const BUILD_DATE = __BUILD_DATE__

export interface ChangelogEntry {
  date: string
  version: string
  title: string
  items: string[]
}

export const formatBuildDate = (value = BUILD_DATE) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const lines = markdown.split(/\r?\n/)
  const entries: ChangelogEntry[] = []
  let current: ChangelogEntry | null = null

  for (const line of lines) {
    const versionMatch = line.match(/^##\s+(.+?)\s+—\s+(.+)$/)
    if (versionMatch) {
      current = { version: versionMatch[1].trim(), date: versionMatch[2].trim(), title: '', items: [] }
      entries.push(current)
      continue
    }

    if (!current) continue
    const titleMatch = line.match(/^###\s+(.+)$/)
    if (titleMatch) {
      current.title = titleMatch[1].trim()
      continue
    }

    const itemMatch = line.match(/^-\s+(.+)$/)
    if (itemMatch) current.items.push(itemMatch[1].trim())
  }

  return entries
}

export const CHANGELOG = parseChangelog(changelogMarkdown)
