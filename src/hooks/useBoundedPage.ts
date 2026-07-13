import { useMemo, useState } from 'react'

export function useBoundedPage<T>(items: T[], pageSize: number) {
  const [requestedOffset, setRequestedOffset] = useState(0)
  const maximumOffset = Math.max(0, Math.floor(Math.max(0, items.length - 1) / pageSize) * pageSize)
  const offset = Math.min(requestedOffset, maximumOffset)
  const visibleItems = useMemo(() => items.slice(offset, offset + pageSize), [items, offset, pageSize])

  return {
    visibleItems,
    offset,
    start: items.length ? offset + 1 : 0,
    end: Math.min(offset + pageSize, items.length),
    total: items.length,
    hasPrevious: offset > 0,
    hasNext: offset + pageSize < items.length,
    previous: () => setRequestedOffset(Math.max(0, offset - pageSize)),
    next: () => setRequestedOffset(Math.min(maximumOffset, offset + pageSize))
  }
}
