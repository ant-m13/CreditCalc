import { describe, expect, it } from 'vitest'
import packageJson from '../package.json'
import { APP_VERSION, CHANGELOG } from './version'

describe('release version', () => {
  it('показывает ту же версию, что package и верхняя секция changelog', () => {
    expect(packageJson.version).toBe('1.7.3')
    expect(APP_VERSION).toBe(packageJson.version)
    expect(CHANGELOG[0]).toMatchObject({ version: packageJson.version, date: '13.07.2026' })
    expect(CHANGELOG[0].items).toContain('Версия приложения повышена до 1.7.3.')
  })
})
