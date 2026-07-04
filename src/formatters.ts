import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

export const formatMoney = (value: number, currency = 'RUB', decimals: 0 | 2 = 2, compact = false) => new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency,
  minimumFractionDigits: compact ? 0 : decimals,
  maximumFractionDigits: compact ? 0 : decimals,
  notation: compact ? 'compact' : 'standard'
}).format(value)

export const currencySymbol = (currency = 'RUB') =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).formatToParts(0).find(part => part.type === 'currency')?.value ?? currency

export const createMoneyFormatter = (currency = 'RUB', decimals: 0 | 2 = 2) => ({
  money: (value: number, compact = false) => formatMoney(value, currency, decimals, compact),
  currencySymbol: currencySymbol(currency)
})

export const shortDate = (value: string) => format(parseISO(value), 'dd MMM yyyy', { locale: ru })
export const plural = (n: number, one: string, few: string, many: string) => n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many
export const fmtMonths = (n: number) => { const years = Math.floor(n / 12), months = n % 12; return [years ? `${years} ${plural(years, 'год', 'года', 'лет')}` : '', months ? `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')}` : ''].filter(Boolean).join(' ') || '0 месяцев' }
export const fmtMonthsFull = (n: number) => `${fmtMonths(n)} (${n} ${plural(n, 'месяц', 'месяца', 'месяцев')})`
