// @vitest-environment node
// @ts-expect-error -- сборочный tsconfig намеренно исключает @types/node; Vitest выполняет файл в Node.js.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose?: string
}

interface WebManifest {
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  icons: ManifestIcon[]
}

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8')) as WebManifest

const pngSize = (name: string) => {
  const png = readFileSync(new URL(`../public/${name}`, import.meta.url))
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

describe('PWA manifest', () => {
  it('остаётся переносимым между GitHub Pages scope и standalone dist', () => {
    expect(manifest).toMatchObject({ name: 'CreditCalc — кредитный график', short_name: 'CreditCalc', start_url: './', scope: './', display: 'standalone' })
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(html).toContain('rel="manifest" href="manifest.webmanifest"')
    expect(html).toContain('rel="apple-touch-icon" href="apple-touch-icon.png"')
  })

  it('содержит отдельные обычные и maskable PNG-иконки требуемых размеров', () => {
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }),
      expect.objectContaining({ src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }),
      expect.objectContaining({ src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' })
    ]))
    expect(pngSize('pwa-192.png')).toEqual({ width: 192, height: 192 })
    expect(pngSize('pwa-512.png')).toEqual({ width: 512, height: 512 })
    expect(pngSize('pwa-maskable-512.png')).toEqual({ width: 512, height: 512 })
    expect(pngSize('apple-touch-icon.png')).toEqual({ width: 180, height: 180 })
  })
})
