import type { LoanConfig } from '../loanEngine'
import { currencySymbol } from '../formatters'
import { Field, NumberInput } from './ui'

type TextScale = 'normal' | 'large' | 'xlarge'
type ThemeName = 'emerald' | 'ocean' | 'violet' | 'graphite' | 'warm' | 'night'

interface SettingsProps {
  config: LoanConfig
  update: (patch: Partial<LoanConfig>) => void
  updateInterest: (patch: Partial<LoanConfig['interest']>) => void
  termUnit: 'months' | 'years'
  setTermUnit: (unit: 'months' | 'years') => void
  displayDecimals: 0 | 2
  setDisplayDecimals: (value: 0 | 2) => void
  appFontSize: TextScale
  setAppFontSize: (value: TextScale) => void
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
  customAccentColor: string
  useCustomAccentColor: boolean
  setCustomAccentColor: (color: string) => void
  setUseCustomAccentColor: (enabled: boolean) => void
  resetCustomAccentColor: () => void
}

export function Settings({
  config, update, updateInterest, termUnit, setTermUnit,
  displayDecimals, setDisplayDecimals, appFontSize, setAppFontSize,
  theme, setTheme, customAccentColor, useCustomAccentColor,
  setCustomAccentColor, setUseCustomAccentColor, resetCustomAccentColor
}: SettingsProps) {
  return <div className="settings-layout">
    <section className="panel form-panel loan-settings-panel">
      <div className="panel-head"><div><h3>Параметры кредита</h3><p>Основные условия из кредитного договора</p></div></div>
      <div className="form-grid">
        <Field label="Сумма кредита"><NumberInput value={config.principal} min="1" onCommit={principal => update({ principal })}/></Field>
        <Field label="Годовая ставка"><div className="with-suffix"><NumberInput value={config.annualRate} min="0" max="100" step="0.1" onCommit={annualRate => update({ annualRate })}/><i>%</i></div></Field>
        <Field label="Дата выдачи"><input type="date" value={config.issueDate} onChange={e => update({ issueDate: e.target.value })}/></Field>
        <Field label="Первый платёж"><input type="date" value={config.firstPaymentDate} onChange={e => update({ firstPaymentDate: e.target.value })}/></Field>
        <label className="toggle-row"><div><b>Первый платёж только проценты</b><span>Без погашения тела кредита</span></div><input type="checkbox" checked={config.firstPaymentInterestOnly} onChange={e => update({ firstPaymentInterestOnly: e.target.checked })}/></label>
        <Field label="Срок кредита"><div className="term-control"><NumberInput min="1" step={termUnit === 'years' ? .25 : 1} value={termUnit === 'years' ? Number((config.termMonths / 12).toFixed(2)) : config.termMonths} onCommit={value => update({ termMonths: Math.max(1, Math.round(value * (termUnit === 'years' ? 12 : 1))) })}/><select aria-label="Единица срока" value={termUnit} onChange={e => setTermUnit(e.target.value as 'months' | 'years')}><option value="months">месяцев</option><option value="years">лет</option></select></div></Field>
        <Field label="День платежа"><NumberInput min="1" max="31" step="1" value={config.paymentDay} onCommit={paymentDay => update({ paymentDay })}/></Field>
        <Field label="Тип платежа"><select value={config.paymentType} onChange={e => update({ paymentType: e.target.value as LoanConfig['paymentType'] })}><option value="annuity">Аннуитетный</option><option value="differentiated">Дифференцированный</option></select></Field>
        <Field label="Периодичность"><select value={config.frequency} onChange={e => update({ frequency: e.target.value as LoanConfig['frequency'] })}><option value="monthly">Ежемесячно</option><option value="biweekly">Раз в 2 недели</option><option value="quarterly">Ежеквартально</option></select></Field>
        <Field label="Валюта"><select value={config.currency} onChange={e => update({ currency: e.target.value as LoanConfig['currency'] })}><option value="RUB">Российский рубль (₽)</option><option value="USD">Доллар США ($)</option><option value="EUR">Евро (€)</option><option value="CNY">Китайский юань (¥)</option></select></Field>
      </div>
    </section>

    <section className="panel form-panel interest-settings-panel">
      <div className="panel-head"><div><h3>Начисление процентов</h3><p>Настройте точное правило вашего банка</p></div></div>
      <div className="form-grid">
        <Field label="Метод"><select value={config.interest.method} onChange={e => updateInterest({ method: e.target.value as LoanConfig['interest']['method'] })}><option value="daily">По фактическим дням</option><option value="annuity">Номинальная ставка / период</option></select></Field>
        <Field label="База года"><select value={config.interest.dayCountBasis} onChange={e => updateInterest({ dayCountBasis: e.target.value as LoanConfig['interest']['dayCountBasis'] })}><option value="actualActual">Фактические дни / фактический год</option><option value="actual365">Фактические дни / 365 дней</option><option value="365">365 дней</option><option value="366">366 дней</option><option value="360">360 дней</option></select></Field>
        <Field label="Округление"><select value={config.rounding} onChange={e => update({ rounding: e.target.value as LoanConfig['rounding'] })}><option value="kopecks">До копеек</option><option value="rubles">До рублей</option><option value="bank">Банковское</option></select></Field>
        <Field label="Порог закрытия"><div className="with-suffix"><NumberInput min="0" value={config.closeThreshold} onCommit={closeThreshold => update({ closeThreshold })}/><i>{currencySymbol()}</i></div></Field>
        <label className="toggle-row"><div><b>Включать дату платежа</b><span>В расчёт процентного периода</span></div><input type="checkbox" checked={config.interest.includePaymentDate} onChange={e => updateInterest({ includePaymentDate: e.target.checked })}/></label>
        <Field label="Начало периода"><select value={config.interest.periodStart} onChange={e => updateInterest({ periodStart: e.target.value as LoanConfig['interest']['periodStart'] })}><option value="inclusive">С даты прошлой операции</option><option value="exclusive">Со следующего дня</option></select></Field>
        <Field label="Остаток для начисления"><select value={config.interest.balanceMoment} onChange={e => updateInterest({ balanceMoment: e.target.value as LoanConfig['interest']['balanceMoment'] })}><option value="startOfDay">На начало дня</option><option value="endOfDay">На конец дня</option></select></Field>
      </div>
    </section>

    <section className="panel form-panel fees-settings-panel">
      <div className="panel-head"><div><h3>Комиссии</h3><p>Необязательные расходы по договору</p></div></div>
      <div className="form-grid">
        <Field label="Единовременная"><NumberInput min="0" value={config.oneTimeFee} onCommit={oneTimeFee => update({ oneTimeFee })}/></Field>
        <Field label="Ежемесячная"><NumberInput min="0" value={config.monthlyFee} onCommit={monthlyFee => update({ monthlyFee })}/></Field>
        <Field label="За досрочное погашение"><div className="with-suffix"><NumberInput min="0" max="100" value={config.earlyRepaymentFeePercent} onCommit={earlyRepaymentFeePercent => update({ earlyRepaymentFeePercent: Math.min(100, Math.max(0, earlyRepaymentFeePercent)) })}/><i>%</i></div></Field>
      </div>
    </section>

    <section className="panel form-panel appearance-panel">
      <div className="panel-head"><div><h3>Интерфейс</h3><p>Внешний вид, общий масштаб текста и формат отображения сумм</p></div></div>
      <div className="form-grid">
        <Field label="Цветовая схема">
          <select value={theme} onChange={e => setTheme(e.target.value as ThemeName)}>
            <option value="emerald">Изумрудная</option>
            <option value="ocean">Океан</option>
            <option value="violet">Фиолетовая</option>
            <option value="graphite">Графитовая</option>
            <option value="warm">Тёплая</option>
            <option value="night">Ночная</option>
          </select>
        </Field>
        <Field label="Акцентный цвет">
          <div className="accent-picker">
            <input aria-label="Свой акцентный цвет" type="color" value={customAccentColor} onChange={e => setCustomAccentColor(e.target.value)}/>
            <span>{customAccentColor.toUpperCase()}</span>
            <button className="ghost compact" onClick={resetCustomAccentColor}>Сбросить</button>
          </div>
        </Field>
        <label className="toggle-row">
          <div><b>Использовать свой акцент</b><span>Меняет кнопки, выделения и ключевые элементы</span></div>
          <input type="checkbox" checked={useCustomAccentColor} onChange={e => setUseCustomAccentColor(e.target.checked)}/>
        </label>
        <Field label="Точность денежных сумм"><select value={displayDecimals} onChange={e => setDisplayDecimals(Number(e.target.value) as 0 | 2)}><option value="2">До копеек — 0,00 ₽</option><option value="0">До рублей — 0 ₽</option></select></Field>
        <Field label="Масштаб текста"><select value={appFontSize} onChange={e => setAppFontSize(e.target.value as TextScale)}><option value="normal">Обычный</option><option value="large">Крупнее</option><option value="xlarge">Максимальный</option></select></Field>
      </div>
    </section>
  </div>
}
