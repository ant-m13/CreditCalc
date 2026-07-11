// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob, OBJECT_URL_REVOKE_DELAY_MS } from './download'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('downloadBlob', () => {
  it('отзывает object URL только после запуска скачивания и защитной задержки', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download-test')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const blob = new Blob(['backup'], { type: 'application/json' })

    downloadBlob(blob, 'backup.json')

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY_MS - 1)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download-test')
  })
})
