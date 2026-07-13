import { describe, expect, it } from 'vitest'
import { accentPresentation, contrastRatio, defaultAccentColor, normalizeAccentColor } from './accentColor'

describe('безопасный пользовательский акцент', () => {
  it('ограничивает слишком светлые и слишком тёмные цвета для обеих тем', () => {
    for (const input of ['#ffffff', '#000000', '#ffff00', '#000011']) {
      const color = normalizeAccentColor(input)
      expect(contrastRatio(color, '#fff8ef')).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(color, '#08111f')).toBeGreaterThanOrEqual(3)
    }
  })

  it('подбирает текст с контрастом 4.5:1 и контрастный цвет поверх акцента', () => {
    for (const nightTheme of [false, true]) {
      const presentation = accentPresentation('#777777', nightTheme)
      expect(contrastRatio(presentation.text, nightTheme ? '#08111f' : '#fff8ef')).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(presentation.contrast, presentation.accent)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('отклоняет невалидный CSS-цвет', () => {
    expect(normalizeAccentColor('red')).toBe(defaultAccentColor)
  })
})
