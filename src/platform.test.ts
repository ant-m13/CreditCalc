// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: false,
  print: vi.fn(async () => {}),
  setStyle: vi.fn(async () => {})
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
  registerPlugin: (name: string) => {
    if (name === 'AndroidPrint') return { print: mocks.print }
    throw new Error(`Неожиданная регистрация плагина: ${name}`)
  },
  SystemBars: { setStyle: mocks.setStyle },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT' }
}))

import { printDocument, setSystemBarsForTheme } from './platform'

describe('platform integrations', () => {
  beforeEach(() => {
    mocks.native = false
    mocks.print.mockClear()
    mocks.setStyle.mockClear()
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

  it('передаёт тему встроенному нативному плагину SystemBars', async () => {
    mocks.native = true

    await setSystemBarsForTheme(true)
    await setSystemBarsForTheme(false)

    expect(mocks.setStyle).toHaveBeenNthCalledWith(1, { style: 'DARK' })
    expect(mocks.setStyle).toHaveBeenNthCalledWith(2, { style: 'LIGHT' })
  })

  it('не вызывает SystemBars в браузере', async () => {
    await setSystemBarsForTheme(true)

    expect(mocks.setStyle).not.toHaveBeenCalled()
  })
})
