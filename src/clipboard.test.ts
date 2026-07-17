// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: false,
  read: vi.fn(async () => ({ type: 'text/plain', value: 'из Android' })),
  write: vi.fn(async () => {})
}))

vi.mock('./platform', () => ({ isNativeApp: () => mocks.native }))
vi.mock('@capacitor/clipboard', () => ({ Clipboard: { read: mocks.read, write: mocks.write } }))

import { readClipboardText, writeClipboardText } from './clipboard'

describe('clipboard', () => {
  beforeEach(() => {
    mocks.native = false
    mocks.read.mockClear()
    mocks.write.mockClear()
  })

  it('читает и записывает через Capacitor в Android-приложении', async () => {
    mocks.native = true

    expect(await readClipboardText()).toBe('из Android')
    await writeClipboardText('в Android')

    expect(mocks.read).toHaveBeenCalledOnce()
    expect(mocks.write).toHaveBeenCalledWith({ string: 'в Android' })
  })

  it('использует браузерный API в веб-версии', async () => {
    const readText = vi.fn(async () => 'из браузера')
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText, writeText } })

    expect(await readClipboardText()).toBe('из браузера')
    await writeClipboardText('в браузер')

    expect(readText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith('в браузер')
  })
})
