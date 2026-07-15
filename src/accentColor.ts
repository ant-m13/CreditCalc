export const defaultAccentColor = '#0b9873'

const LIGHT_SURFACE = '#fff8ef'
const DARK_SURFACE = '#08111f'
const MIN_UI_CONTRAST = 3
const MIN_TEXT_CONTRAST = 4.5
const HEX_RADIX = 16
const HEX_CHANNEL_WIDTH = 2
const RGB_CHANNEL_MAX = 255
const CONTRAST_SEARCH_ITERATIONS = 16

type Rgb = [number, number, number]

// Пары индексов выделяют каналы R, G и B из строки формата #RRGGBB.
const parseHex = (value: string): Rgb => [
  Number.parseInt(value.slice(1, 3), HEX_RADIX),
  Number.parseInt(value.slice(3, 5), HEX_RADIX),
  Number.parseInt(value.slice(5, 7), HEX_RADIX)
]

const toHex = (rgb: Rgb) => `#${rgb.map(channel => Math.round(channel).toString(HEX_RADIX).padStart(HEX_CHANNEL_WIDTH, '0')).join('')}`

// Коэффициенты линеаризации и яркости взяты из стандартной формулы относительной яркости sRGB.
const relativeLuminance = (value: string) => {
  const channels = parseHex(value).map(channel => {
    const normalized = channel / RGB_CHANNEL_MAX
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export const contrastRatio = (first: string, second: string) => {
  // Добавка 0,05 является частью стандартной формулы контрастности WCAG.
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

const mix = (color: string, target: string, amount: number): string => {
  const sourceRgb = parseHex(color)
  const targetRgb = parseHex(target)
  return toHex(sourceRgb.map((channel, index) => channel + (targetRgb[index] - channel) * amount) as Rgb)
}

const increaseContrast = (color: string, surface: string, target: '#000000' | '#ffffff') => {
  if (contrastRatio(color, surface) >= MIN_UI_CONTRAST) return color
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < CONTRAST_SEARCH_ITERATIONS; iteration += 1) {
    const middle = (low + high) / 2
    if (contrastRatio(mix(color, target, middle), surface) >= MIN_UI_CONTRAST) high = middle
    else low = middle
  }
  return mix(color, target, high)
}

export const normalizeAccentColor = (value: unknown): string => {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) return defaultAccentColor
  const input = value.toLowerCase()
  const visibleOnLight = increaseContrast(input, LIGHT_SURFACE, '#000000')
  return increaseContrast(visibleOnLight, DARK_SURFACE, '#ffffff')
}

export const accentPresentation = (value: unknown, nightTheme: boolean) => {
  const accent = normalizeAccentColor(value)
  const surface = nightTheme ? DARK_SURFACE : LIGHT_SURFACE
  const fallbackText = nightTheme ? '#f8fbfa' : '#10231f'
  const text = contrastRatio(accent, surface) >= MIN_TEXT_CONTRAST ? accent : fallbackText
  const darkContrast = contrastRatio(accent, '#000000')
  const lightContrast = contrastRatio(accent, '#ffffff')
  return {
    accent,
    text,
    contrast: darkContrast >= lightContrast ? '#000000' : '#ffffff'
  }
}
