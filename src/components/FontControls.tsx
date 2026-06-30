import { Minus, Plus } from 'lucide-react'

const fontLevels = ['normal', 'large', 'xlarge'] as const
type FontSize = typeof fontLevels[number]

const shiftFontSize = (value: FontSize, direction: -1 | 1) => fontLevels[Math.min(fontLevels.length - 1, Math.max(0, fontLevels.indexOf(value) + direction))]

interface FontControlsProps {
  fontSize: FontSize
  setFontSize: (value: FontSize) => void
}

export function FontControls({ fontSize, setFontSize }: FontControlsProps) {
  return <div className="font-controls" aria-label="Быстрая настройка размера текста">
    <span>Текст</span>
    <div><em>Масштаб</em><button type="button" aria-label="Уменьшить текст приложения" onClick={() => setFontSize(shiftFontSize(fontSize, -1))} disabled={fontSize === 'normal'}><Minus size={13}/></button><button type="button" aria-label="Увеличить текст приложения" onClick={() => setFontSize(shiftFontSize(fontSize, 1))} disabled={fontSize === 'xlarge'}><Plus size={13}/></button></div>
  </div>
}
