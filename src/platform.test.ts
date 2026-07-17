// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: false,
  print: vi.fn(async () => {}),
  setStyle: vi.fn(async () => {})
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
  registerPlugin: (name: string) => name === 'AndroidPrint' ? { print: mocks.print } : { setStyle: mocks.setStyle }
}))

import { printDocument } from './platform'

describe('platform print', () => {
  beforeEach(() => {
    mocks.native = false
    mocks.print.mockClear()
  })

  it('открывает системную печать через нативный Android-плагин', async () => {
    mocks.native = true

    await printDocument()

    expect(mocks.print).toHaveBeenCalledWith({ jobName: 'CreditCalc — кредитный график' })
  })

  it('сохраняет браузерную печать для веб-версии', async () => {
    const browserPrint = vi.spyOn(window, 'print').mockImplementation(() => {})

    await printDocument()

    expect(browserPrint).toHaveBeenCalledOnce()
  })
})
