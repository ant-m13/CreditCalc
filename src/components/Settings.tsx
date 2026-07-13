import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { addYears, format, parseISO } from 'date-fns'
import { contractualFinalPaymentDate, sortRateChanges, type LoanConfig, type RateChange } from '../loanEngine'
import { MAX_RATE_CHANGES } from '../loanEngine/limits'
import { currencySymbol } from '../formatters'
import { createId } from '../utils/createId'
import { isISODate } from '../utils/dateValidation'
import { Field, NumberInput } from './ui'

type TextScale = 'normal' | 'large' | 'xlarge'
type ThemeName = 'emerald' | 'ocean' | 'violet' | 'graphite' | 'warm' | 'night'
type SettingHelpProps = { text: string }
type DateCommitInputProps = {
  value: string
  applyLabel: string
  onCommit: (value: string) => boolean | void
  validate?: (value: string) => string
}

const MIN_LOAN_YEAR = 1900
const MIN_LOAN_DATE = `${MIN_LOAN_YEAR}-01-01`
const MAX_DATE_SPAN_YEARS = 120

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
  persistentStorageEnabled: boolean
  setPersistentStorageEnabled: (enabled: boolean) => void
}

function SettingHelp({ text }: SettingHelpProps) {
  return <details className="field-help setting-help" onClick={event => event.stopPropagation()}><summary aria-label="Что влияет">?</summary><p>{text}</p></details>
}

const dateDraftError = (value: string) => {
  if (!isISODate(value)) return 'Укажите корректную дату'
  if (Number(value.slice(0, 4)) < MIN_LOAN_YEAR) return `Укажите год не раньше ${MIN_LOAN_YEAR}`
  return ''
}

const isAfterDateHorizon = (startDate: string, endDate: string) => {
  if (!isISODate(startDate) || !isISODate(endDate) || endDate <= startDate) return false
  return endDate > format(addYears(parseISO(startDate), MAX_DATE_SPAN_YEARS), 'yyyy-MM-dd')
}

function DateCommitInput({ value, applyLabel, onCommit, validate }: DateCommitInputProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const changed = draft !== value
  const error = changed ? dateDraftError(draft) || validate?.(draft) || '' : ''
  const canCommit = changed && !error
  const commit = () => {
    if (canCommit && onCommit(draft) === false) setDraft(value)
  }

  return <>
    <div className="date-commit-control">
      <input type="date" min={MIN_LOAN_DATE} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}/>
      <button type="button" className="ghost compact" aria-label={applyLabel} disabled={!canCommit} onClick={commit}>Применить</button>
    </div>
    {error && <span className="date-commit-error">{error}</span>}
  </>
}

export function Settings({
  config, update, updateInterest, termUnit, setTermUnit,
  displayDecimals, setDisplayDecimals, appFontSize, setAppFontSize,
  theme, setTheme, customAccentColor, useCustomAccentColor,
  setCustomAccentColor, setUseCustomAccentColor, resetCustomAccentColor,
  persistentStorageEnabled, setPersistentStorageEnabled
}: SettingsProps) {
  const [newRateDate, setNewRateDate] = useState('')
  const [newRateAnnualRate, setNewRateAnnualRate] = useState(config.annualRate)
  const [rateError, setRateError] = useState('')
  const [configError, setConfigError] = useState('')
  const rateChanges = config.rateChanges ?? []
  const contractFinalDate = isISODate(config.firstPaymentDate) ? contractualFinalPaymentDate(config) : config.firstPaymentDate
  const hasRateAfterContractEnd = isISODate(contractFinalDate) && rateChanges.some(change => isISODate(change.date) && change.date > contractFinalDate)
  useEffect(() => setConfigError(''), [config])
  const commitConfig = (patch: Partial<LoanConfig>) => {
    try {
      update(patch)
      setConfigError('')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось изменить параметры кредита'
      setConfigError(`Изменение отклонено: ${message}`)
      return false
    }
  }
  const commitInterest = (patch: Partial<LoanConfig['interest']>) => {
    try {
      updateInterest(patch)
      setConfigError('')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось изменить параметры начисления'
      setConfigError(`Изменение отклонено: ${message}`)
      return false
    }
  }
  const updateRateChanges = (items: RateChange[]) => commitConfig({ rateChanges: sortRateChanges(items) })
  const addRateChange = () => {
    if (rateChanges.length >= MAX_RATE_CHANGES) {
      setRateError(`Можно добавить не более ${MAX_RATE_CHANGES} изменений ставки`)
      return
    }
    if (!isISODate(newRateDate)) {
      setRateError('Укажите корректную дату изменения ставки')
      return
    }
    if (newRateDate <= config.issueDate) {
      setRateError('Дата изменения ставки должна быть после выдачи кредита')
      return
    }
    if (rateChanges.some(item => item.date === newRateDate)) {
      setRateError('На эту дату уже есть изменение ставки')
      return
    }
    if (!updateRateChanges([...rateChanges, { id: createId('rate'), date: newRateDate, annualRate: newRateAnnualRate }])) return
    setNewRateDate('')
    setRateError('')
  }
  const editRateChange = (id: string, patch: Partial<RateChange>) => {
    if (!rateChanges.some(item => item.id === id)) {
      setRateError('Изменение ставки уже не найдено в этом кредите')
      return false
    }
    if (patch.date !== undefined) {
      if (!isISODate(patch.date)) {
        setRateError('Укажите корректную дату изменения ставки')
        return false
      }
      if (patch.date <= config.issueDate) {
        setRateError('Дата изменения ставки должна быть после выдачи кредита')
        return false
      }
      if (rateChanges.some(item => item.id !== id && item.date === patch.date)) {
        setRateError('На эту дату уже есть изменение ставки')
        return false
      }
    }
    setRateError('')
    return updateRateChanges(rateChanges.map(item => item.id === id ? { ...item, ...patch } : item))
  }
  const removeRateChange = (id: string) => {
    if (!rateChanges.some(item => item.id === id)) {
      setRateError('Изменение ставки уже не найдено в этом кредите')
      return
    }
    setRateError('')
    updateRateChanges(rateChanges.filter(item => item.id !== id))
  }
  return <div className="settings-layout">
    {configError && <div className="alert settings-error" role="alert">{configError}</div>}
    <section className="panel form-panel loan-settings-panel">
      <div className="panel-head"><div><h3>Параметры кредита</h3><p>Основные условия из кредитного договора</p></div></div>
      <div className="form-grid">
        <div className="setting-item"><Field label="Сумма кредита" help="Начальный основной долг. От него считаются проценты, аннуитетный платеж, переплата и прогресс погашения."><NumberInput value={config.principal} min="1" onCommit={principal => commitConfig({ principal })}/></Field></div>
        <div className="setting-item"><Field label="Годовая ставка" help="Процентная ставка банка. Влияет на начисленные проценты, долю тела в каждом платеже, переплату и срок после досрочных погашений."><div className="with-suffix"><NumberInput value={config.annualRate} min="0" max="100" step="0.1" onCommit={annualRate => commitConfig({ annualRate })}/><i>%</i></div></Field></div>
        <div className="setting-item"><Field label="Дата выдачи" help="День выдачи кредита и старт первого процентного периода. От него зависит количество дней до первого платежа."><DateCommitInput value={config.issueDate} applyLabel="Применить дату выдачи" onCommit={issueDate => commitConfig({ issueDate })} validate={issueDate => isAfterDateHorizon(issueDate, config.firstPaymentDate) ? `Первый платёж должен быть в пределах ${MAX_DATE_SPAN_YEARS} лет от даты выдачи` : ''}/></Field></div>
        <div className="setting-item"><Field label="Первый платёж" help="Первая плановая дата списания. Задает первый расчетный период и дальнейший календарь платежей."><DateCommitInput value={config.firstPaymentDate} applyLabel="Применить дату первого платежа" onCommit={firstPaymentDate => commitConfig({ firstPaymentDate })} validate={firstPaymentDate => isAfterDateHorizon(config.issueDate, firstPaymentDate) ? `Первый платёж должен быть в пределах ${MAX_DATE_SPAN_YEARS} лет от даты выдачи` : ''}/></Field></div>
        <div className="setting-item"><label className="toggle-row"><div><b className="setting-title">Первый платёж только проценты<SettingHelp text="Первое списание считается дополнительным stub-периодом: оно погашает только проценты и не уменьшает число последующих амортизирующих платежей. Договорная дата закрытия сдвигается на один платёжный период."/></b><span>Дополнительный период без погашения тела</span></div><input type="checkbox" checked={config.firstPaymentInterestOnly} onChange={e => commitConfig({ firstPaymentInterestOnly: e.target.checked })}/></label></div>
        <div className="setting-item"><Field label="Срок кредита" help="Договорной срок. Используется для расчета регулярного платежа и для сравнения, сколько месяцев экономят досрочные погашения."><div className="term-control"><NumberInput min="1" step={termUnit === 'years' ? .25 : 1} value={termUnit === 'years' ? Number((config.termMonths / 12).toFixed(2)) : config.termMonths} onCommit={value => commitConfig({ termMonths: Math.max(1, Math.round(value * (termUnit === 'years' ? 12 : 1))) })}/><select aria-label="Единица срока" value={termUnit} onChange={e => setTermUnit(e.target.value as 'months' | 'years')}><option value="months">месяцев</option><option value="years">лет</option></select></div></Field></div>
        <div className="setting-item"><Field label="День платежа" help="День месяца для следующих платежей. Меняет длину процентных периодов и даты строк графика."><NumberInput min="1" max="31" step="1" value={config.paymentDay} onCommit={paymentDay => commitConfig({ paymentDay })}/></Field></div>
        <div className="setting-item"><Field label="Тип платежа" help="Аннуитет держит платеж почти постоянным, дифференцированный гасит равную часть тела. Меняет весь график и эффект досрочных платежей."><select value={config.paymentType} onChange={e => commitConfig({ paymentType: e.target.value as LoanConfig['paymentType'] })}><option value="annuity">Аннуитетный</option><option value="differentiated">Дифференцированный</option></select></Field></div>
        <div className="setting-item"><Field label="Периодичность" help="Частота регулярных платежей. Влияет на количество платежей в году, даты графика и расчет платежа."><select value={config.frequency} onChange={e => commitConfig({ frequency: e.target.value as LoanConfig['frequency'] })}><option value="monthly">Ежемесячно</option><option value="biweekly">Раз в 2 недели</option><option value="quarterly">Ежеквартально</option></select></Field></div>
        <div className="setting-item"><Field label="Валюта" help="Меняет символ валюты в интерфейсе, отчете и экспорте. Математически суммы не конвертируются."><select value={config.currency} onChange={e => commitConfig({ currency: e.target.value as LoanConfig['currency'] })}><option value="RUB">Российский рубль (₽)</option><option value="USD">Доллар США ($)</option><option value="EUR">Евро (€)</option><option value="CNY">Китайский юань (¥)</option></select></Field></div>
      </div>
    </section>

    <section className="panel form-panel interest-settings-panel">
      <div className="panel-head"><div><h3>Начисление процентов</h3><p>Настройте точное правило вашего банка</p></div></div>
      <div className="form-grid">
        <div className="setting-item"><Field label="Метод" help="Выбирает формулу процентов. Фактические дни нужны для банковских графиков с разной длиной месяцев; номинальная ставка делит год на равные периоды."><select value={config.interest.method} onChange={e => commitInterest({ method: e.target.value as LoanConfig['interest']['method'] })}><option value="daily">По фактическим дням</option><option value="annuity">Номинальная ставка / период</option></select></Field></div>
        <div className="setting-item"><Field label="База года (для фактических дней)" help="Знаменатель дневной ставки. При методе «Номинальная ставка / период» база года не участвует в формуле."><select disabled={config.interest.method !== 'daily'} value={config.interest.dayCountBasis} onChange={e => commitInterest({ dayCountBasis: e.target.value as LoanConfig['interest']['dayCountBasis'] })}><option value="actualActual">Фактические дни / фактический год</option><option value="actual365">Фактические дни / 365 дней</option><option value="366">Фактические дни / 366 дней</option><option value="360">Фактические дни / 360 дней</option></select>{config.interest.method !== 'daily' && <span>Не применяется: ставка делится на число платёжных периодов в году.</span>}</Field></div>
        <div className="setting-item"><Field label="Округление" help="Правило округления платежей и процентов. Может давать копеечные отличия в остатке и итоговой переплате."><select value={config.rounding} onChange={e => commitConfig({ rounding: e.target.value as LoanConfig['rounding'] })}><option value="kopecks">До копеек</option><option value="rubles">До рублей</option><option value="bank">Банковское</option></select></Field></div>
        <div className="setting-item"><Field label="Порог закрытия" help="Если остаток тела стал меньше порога, приложение добавит его к ближайшему платежу и закроет кредит."><div className="with-suffix"><NumberInput min="0" value={config.closeThreshold} onCommit={closeThreshold => commitConfig({ closeThreshold })}/><i>{currencySymbol(config.currency)}</i></div></Field></div>
        <div className="setting-item"><label className="toggle-row"><div><b className="setting-title">Включать дату платежа<SettingHelp text="Определяет, начисляются ли проценты за сам день платежа. Влияет на проценты каждой строки и текущий долг между платежами."/></b><span>В расчёт процентного периода</span></div><input type="checkbox" checked={config.interest.includePaymentDate} onChange={e => commitInterest({ includePaymentDate: e.target.checked })}/></label></div>
        <div className="setting-item"><Field label="Начало периода" help="Задает, включается ли дата прошлой операции в новый процентный период. Для многих банков подходит “со следующего дня”."><select value={config.interest.periodStart} onChange={e => commitInterest({ periodStart: e.target.value as LoanConfig['interest']['periodStart'] })}><option value="inclusive">С даты прошлой операции</option><option value="exclusive">Со следующего дня</option></select></Field></div>
        <div className="setting-item"><Field label="Остаток для начисления" help="Определяет, на какой остаток начислять проценты в день платежа или досрочного погашения. Важно для банков, которые меняют остаток до или после начисления."><select value={config.interest.balanceMoment} onChange={e => commitInterest({ balanceMoment: e.target.value as LoanConfig['interest']['balanceMoment'] })}><option value="startOfDay">На начало дня</option><option value="endOfDay">На конец дня</option></select></Field></div>
      </div>
    </section>

    <section className="panel form-panel fees-settings-panel">
      <div className="panel-head"><div><h3>Комиссии</h3><p>Необязательные расходы по договору</p></div></div>
      <div className="form-grid">
        <div className="setting-item"><Field label="Единовременная" help="Разовый расход при выдаче кредита. Попадает в денежный поток и переплату, но не увеличивает основной долг."><NumberInput min="0" value={config.oneTimeFee} onCommit={oneTimeFee => commitConfig({ oneTimeFee })}/></Field></div>
        <div className="setting-item"><Field label="Ежемесячная" help="Дополнительная комиссия в каждой регулярной строке. Увеличивает общую сумму выплат и переплату."><NumberInput min="0" value={config.monthlyFee} onCommit={monthlyFee => commitConfig({ monthlyFee })}/></Field></div>
        <div className="setting-item"><Field label="За досрочное погашение" help="Процент комиссии удерживается из суммы досрочного платежа. Чем выше комиссия, тем меньше денег идет в проценты и тело кредита."><div className="with-suffix"><NumberInput min="0" max="100" value={config.earlyRepaymentFeePercent} onCommit={earlyRepaymentFeePercent => commitConfig({ earlyRepaymentFeePercent: Math.min(100, Math.max(0, earlyRepaymentFeePercent)) })}/><i>%</i></div></Field></div>
      </div>
    </section>

    <section className="panel form-panel rate-settings-panel">
      <div className="panel-head"><div><h3>Изменение ставки</h3><p>История ставок для сверки с банковским графиком</p></div></div>
      <div className="rate-change-form">
        <Field label="Режим применения" help="Со следующего периода ставка меняет весь следующий платёжный период. Точно с даты изменения разрезает процентный период на сегменты с разными ставками."><select value={config.rateChangeMode} onChange={e => commitConfig({ rateChangeMode: e.target.value as LoanConfig['rateChangeMode'] })}><option value="nextPeriod">Со следующего периода</option><option value="exactDate">Точно с даты изменения</option></select></Field>
        <Field label="Дата изменения" help={config.rateChangeMode === 'exactDate' ? 'Дата, с которой новая ставка применяется внутри текущего процентного периода; начисление делится на сегменты до и после этой даты.' : 'Дата изменения по договору; новая ставка влияет на расчёт со следующего платёжного периода.'}><input type="date" value={newRateDate} onChange={e => setNewRateDate(e.target.value)}/></Field>
        <Field label="Новая ставка" help={config.rateChangeMode === 'exactDate' ? 'Годовая ставка, действующая точно с указанной даты изменения.' : 'Годовая ставка, которая будет применяться после ближайшего планового платежа.'}><div className="with-suffix"><NumberInput value={newRateAnnualRate} min="0" max="100" step="0.1" onCommit={setNewRateAnnualRate}/><i>%</i></div></Field>
        <button className="primary rate-add-button" onClick={addRateChange}><Plus size={16}/>Добавить</button>
      </div>
      <div className="tip">{config.rateChangeMode === 'exactDate' ? 'В режиме точной даты проценты внутри периода делятся на сегменты по ставкам.' : 'Новая ставка применяется со следующего платёжного периода.'}</div>
      {hasRateAfterContractEnd && <div className="tip">В истории есть ставка после ориентировочной договорной даты закрытия {contractFinalDate}. Она сохранится в расчёте, но может не повлиять на график.</div>}
      {rateError && <p className="inline-error">{rateError}</p>}
      {rateChanges.length > 0 && <div className="rate-change-list">
        {rateChanges.map(change => <div className="rate-change-row" key={change.id}>
          <Field label="Дата"><DateCommitInput value={change.date} applyLabel="Применить дату изменения ставки" onCommit={date => editRateChange(change.id, { date })} validate={date => {
            if (date <= config.issueDate) return 'Дата изменения ставки должна быть после выдачи кредита'
            if (rateChanges.some(item => item.id !== change.id && item.date === date)) return 'На эту дату уже есть изменение ставки'
            if (isAfterDateHorizon(config.issueDate, date)) return `Дата изменения ставки должна быть в пределах ${MAX_DATE_SPAN_YEARS} лет от даты выдачи`
            return ''
          }}/></Field>
          <Field label="Ставка"><div className="with-suffix"><NumberInput value={change.annualRate} min="0" max="100" step="0.1" onCommit={annualRate => editRateChange(change.id, { annualRate })}/><i>%</i></div></Field>
          <button className="icon-btn danger" title="Удалить изменение ставки" aria-label="Удалить изменение ставки" onClick={() => removeRateChange(change.id)}><Trash2 size={17}/></button>
        </div>)}
      </div>}
    </section>

    <section className="panel form-panel appearance-panel">
      <div className="panel-head"><div><h3>Интерфейс</h3><p>Внешний вид, общий масштаб текста и формат отображения сумм</p></div></div>
      <div className="form-grid">
        <div className="setting-item"><Field label="Цветовая схема" help="Меняет визуальную тему приложения. На расчеты и сохраненные данные не влияет.">
          <select value={theme} onChange={e => setTheme(e.target.value as ThemeName)}>
            <option value="emerald">Изумрудная</option>
            <option value="ocean">Океан</option>
            <option value="violet">Фиолетовая</option>
            <option value="graphite">Графитовая</option>
            <option value="warm">Тёплая</option>
            <option value="night">Ночная</option>
          </select>
        </Field></div>
        <div className="setting-item"><Field label="Акцентный цвет" help="Задает пользовательский цвет кнопок, выделений и ключевых элементов. Слишком светлый или тёмный оттенок автоматически корректируется до доступного контраста.">
          <div className="accent-picker">
            <input aria-label="Свой акцентный цвет" type="color" value={customAccentColor} onChange={e => setCustomAccentColor(e.target.value)}/>
            <span>{customAccentColor.toUpperCase()}</span>
            <button className="ghost compact" onClick={resetCustomAccentColor}>Сбросить</button>
          </div>
        </Field></div>
        <div className="setting-item"><label className="toggle-row">
          <div><b className="setting-title">Использовать свой акцент<SettingHelp text="Включает или отключает пользовательский акцентный цвет. Если выключено, используется цвет выбранной темы."/></b><span>Меняет кнопки, выделения и ключевые элементы</span></div>
          <input type="checkbox" checked={useCustomAccentColor} onChange={e => setUseCustomAccentColor(e.target.checked)}/>
        </label></div>
        <div className="setting-item"><label className="toggle-row">
          <div><b className="setting-title">Постоянное сохранение<SettingHelp text="Если выключить, сохранённые кредиты удаляются из localStorage, а дальнейшие изменения остаются только в текущей вкладке. Перед закрытием скачайте JSON."/></b><span>{persistentStorageEnabled ? 'Кредиты хранятся в localStorage' : 'Данные только в памяти этой вкладки'}</span></div>
          <input type="checkbox" checked={persistentStorageEnabled} onChange={e => setPersistentStorageEnabled(e.target.checked)}/>
        </label></div>
        <div className="setting-item"><Field label="Точность денежных сумм" help="Меняет только отображение сумм в интерфейсе. Расчетное ядро продолжает считать по выбранному правилу округления."><select value={displayDecimals} onChange={e => setDisplayDecimals(Number(e.target.value) as 0 | 2)}><option value="2">До копеек — 0,00 ₽</option><option value="0">До рублей — 0 ₽</option></select></Field></div>
        <div className="setting-item"><Field label="Масштаб текста" help="Увеличивает текст приложения и графика для удобства чтения. На расчеты не влияет."><select value={appFontSize} onChange={e => setAppFontSize(e.target.value as TextScale)}><option value="normal">Обычный</option><option value="large">Крупнее</option><option value="xlarge">Максимальный</option></select></Field></div>
      </div>
    </section>
  </div>
}
