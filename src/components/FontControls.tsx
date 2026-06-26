import { Minus, Plus } from 'lucide-react'

const fontLevels = ['normal', 'large', 'xlarge'] as const
type FontSize = typeof fontLevels[number]

const shiftFontSize = (value: FontSize, direction: -1 | 1) => fontLevels[Math.min(fontLevels.length - 1, Math.max(0, fontLevels.indexOf(value) + direction))]

interface FontControlsProps {
  appFontSize: FontSize
  scheduleFontSize: FontSize
  setAppFontSize: (value: FontSize) => void
  setScheduleFontSize: (value: FontSize) => void
}

export function FontControls({ appFontSize, scheduleFontSize, setAppFontSize, setScheduleFontSize }: FontControlsProps) {
  return <div className="font-controls" aria-label="Быстрая настройка размера текста">
    <span>Текст</span>
    <div><em>Всё</em><button type="button" aria-label="Уменьшить текст приложения" onClick={() => setAppFontSize(shiftFontSize(appFontSize, -1))} disabled={appFontSize === 'normal'}><Minus size={13}/></button><button type="button" aria-label="Увеличить текст приложения" onClick={() => setAppFontSize(shiftFontSize(appFontSize, 1))} disabled={appFontSize === 'xlarge'}><Plus size={13}/></button></div>
    <div><em>График</em><button type="button" aria-label="Уменьшить текст графика" onClick={() => setScheduleFontSize(shiftFontSize(scheduleFontSize, -1))} disabled={scheduleFontSize === 'normal'}><Minus size={13}/></button><button type="button" aria-label="Увеличить текст графика" onClick={() => setScheduleFontSize(shiftFontSize(scheduleFontSize, 1))} disabled={scheduleFontSize === 'xlarge'}><Plus size={13}/></button></div>
  </div>
}
