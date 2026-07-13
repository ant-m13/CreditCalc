import Decimal from 'decimal.js'
import { addDays, parseISO } from 'date-fns'
import { accrueInterestSegmentsRaw, periodsPerYear } from './accrual'
import { calculateAnnuityPayment } from './calculateAnnuityPayment'
import { periodDays } from './calculateInterest'
import { extendedPaymentPeriods, iso, nextPaymentDate, preparePaymentCalendar, regularPaymentDateMatches, totalPaymentPeriods, type PreparedPaymentCalendar } from './dates'
import { activeGrace } from './gracePeriod'
import { MAX_EARLY_REPAYMENTS, MAX_GRACE_PERIODS, MAX_SCHEDULE_ROWS } from './limits'
import { createRateTimeline } from './rateChanges'
import { isTotalWithFeeAmountMode } from './repaymentAmountMode'
import { money, num } from './rounding'
import { sortRepaymentsByApplicationOrder } from './repaymentOrder'
import type { EarlyRepayment, GracePeriod, LoanConfig, PaymentScheduleItem, RepaymentApplicationOutcome, RepaymentStrategy, ScheduleEventType } from './types'
import { validateScenario } from './validation'
import { assertFiniteScheduleItem } from './financialSafety'

interface Options { earlyRepayments?: EarlyRepayment[]; gracePeriods?: GracePeriod[]; forcedStrategy?: RepaymentStrategy; paymentCalendar?: PreparedPaymentCalendar; scenarioAlreadyValidated?: boolean }

const clampDebtBalance = (value: Decimal.Value) => Decimal.max(0, new Decimal(value))

const appendUnique = <T,>(items: T[], item: T) => {
  if (!items.includes(item)) items.push(item)
}

const appendScheduleEvent = (labels: string[], types: ScheduleEventType[], label: string, type: ScheduleEventType) => {
  appendUnique(labels, label)
  appendUnique(types, type)
}

const earlyRepaymentEventInfo = (strategy: RepaymentStrategy, fullyClosed: boolean) => {
  if (strategy === 'reduceTerm') return { label: 'Пересчёт · сокращение срока', type: 'earlyReduceTerm' as const }
  if (strategy === 'reducePayment') return { label: 'Пересчёт · уменьшение платежа', type: 'earlyReducePayment' as const }
  if (strategy === 'full') return fullyClosed
    ? { label: 'Полное досрочное погашение', type: 'earlyFull' as const }
    : { label: 'Полное погашение · недостаточно средств', type: 'earlyFullInsufficient' as const }
  return { label: 'Комбинированный пересчёт', type: 'earlyCombined' as const }
}

const shouldExcludeStartDate = (config: LoanConfig) => config.interest.periodStart === 'exclusive'

const nextAccrualStartDate = (config: LoanConfig, date: string, includedEndDate: boolean) =>
  includedEndDate && !shouldExcludeStartDate(config) ? iso(addDays(parseISO(date), 1)) : date

const periodsBeforeCurrentPayment = (currentRemainingPeriods: number) => Math.max(1, currentRemainingPeriods)

const periodsAfterCurrentPayment = (currentRemainingPeriods: number) => Math.max(0, currentRemainingPeriods - 1)

const estimateRemainingPeriods = (
  config: LoanConfig,
  balance: Decimal,
  payment: Decimal,
  principalPerPeriod: Decimal,
  fallback: number,
  annualRate: number
) => {
  const fallbackPeriods = Math.max(1, Math.ceil(fallback))
  if (balance.lte(0)) return 0
  if (config.paymentType === 'differentiated') {
    if (principalPerPeriod.lte(0)) return fallbackPeriods
    return Math.min(fallbackPeriods, Math.max(1, Math.ceil(balance.div(principalPerPeriod).toNumber())))
  }
  if (payment.lte(0)) return fallbackPeriods
  const rate = new Decimal(annualRate).div(100).div(periodsPerYear(config.frequency))
  if (rate.isZero()) return Math.min(fallbackPeriods, Math.max(1, Math.ceil(balance.div(payment).toNumber())))
  if (payment.lte(balance.mul(rate))) return fallbackPeriods
  const ratio = new Decimal(1).minus(balance.mul(rate).div(payment))
  const exactPeriods = ratio.gt(0) && ratio.lt(1) ? -Math.log(ratio.toNumber()) / Math.log(rate.add(1).toNumber()) : Number.NaN
  if (!Number.isFinite(exactPeriods) || exactPeriods <= 0) return fallbackPeriods
  return Math.min(fallbackPeriods, Math.max(1, Math.ceil(exactPeriods)))
}

/**
 * Builds an event-based schedule. An early repayment between two regular due
 * dates is its own row, just as it is in a bank statement: interest is accrued
 * up to the event, the balance changes on that date, and the next interval is
 * calculated from the new balance.
 */
export function generateBaseSchedule(config: LoanConfig, options: Options = {}): PaymentScheduleItem[] {
  const allRepayments = sortRepaymentsByApplicationOrder(options.earlyRepayments ?? [])
  const repayments = allRepayments.filter(item => item.enabled !== false && item.amount > 0)
  const gracePeriods = options.gracePeriods ?? []
  if (allRepayments.length > MAX_EARLY_REPAYMENTS) throw new Error(`Слишком много досрочных платежей. Максимум: ${MAX_EARLY_REPAYMENTS}`)
  if (gracePeriods.length > MAX_GRACE_PERIODS) throw new Error(`Слишком много льготных периодов. Максимум: ${MAX_GRACE_PERIODS}`)
  if (!options.scenarioAlreadyValidated) {
    const validationErrors = validateScenario(config, allRepayments, gracePeriods)
    if (validationErrors.length > 0) throw new Error(validationErrors.join(' · '))
  }
  const paymentCalendar = options.paymentCalendar ?? preparePaymentCalendar(config, gracePeriods)
  const regularRepaymentDates = regularPaymentDateMatches(
    allRepayments.filter(item => item.amountMode !== 'extra').map(item => item.date),
    config
  )
  const configuredPeriods = totalPaymentPeriods(config)
  const maxPeriods = configuredPeriods + extendedPaymentPeriods(config, gracePeriods, paymentCalendar)
  const rateTimeline = createRateTimeline(config)
  let currentRemainingPeriods = maxPeriods
  let balance = money(config.principal, config.rounding)
  let principalPerPeriod = money(new Decimal(balance).div(Math.max(1, configuredPeriods)), config.rounding)
  let currentAnnualRate = config.annualRate
  let payment = config.paymentType === 'annuity' ? calculateAnnuityPayment(balance, currentAnnualRate, configuredPeriods, periodsPerYear(config.frequency), config.rounding) : principalPerPeriod
  let paymentTracksReducedTerm = false
  let paymentDate = config.firstPaymentDate
  let previousPaymentDate = config.issueDate
  let accrualStart = config.issueDate
  let cumulativeInterest = new Decimal(0)
  let deferredInterest = new Decimal(0)
  let repaymentIndex = 0
  let rowNumber = 1
  let pendingRateChange: number | null = null
  const schedule: PaymentScheduleItem[] = [{
    number: 1,
    date: config.issueDate,
    days: 0,
    openingBalance: num(balance, config.rounding),
    payment: 0,
    interest: 0,
    principal: 0,
    earlyPayment: 0,
    interestAccrued: 0,
    interestPaid: 0,
    principalPaid: 0,
    feePaid: num(new Decimal(config.oneTimeFee), config.rounding),
    deferredInterestOpening: 0,
    deferredInterestClosing: 0,
    cashFlowTotal: num(new Decimal(config.oneTimeFee), config.rounding),
    closingBalance: num(balance, config.rounding),
    cumulativeInterest: 0,
    cumulativeSavings: 0,
    fee: num(new Decimal(config.oneTimeFee), config.rounding),
    comment: '',
    event: 'Выдача кредита',
    eventTypes: ['loanIssued'],
    paymentRecalculated: false,
    fullyClosedByEarlyRepayment: false,
    isRegularPayment: false,
    isGracePayment: false
  }]
  assertFiniteScheduleItem(schedule[0])
  const pushScheduleRow = (row: PaymentScheduleItem) => {
    if (schedule.length >= MAX_SCHEDULE_ROWS) {
      throw new Error(`График не закрывает кредит в допустимое количество строк (${MAX_SCHEDULE_ROWS})`)
    }
    assertFiniteScheduleItem(row)
    schedule.push(row)
  }
  const appendPendingRateChange = (labels: string[], types: ScheduleEventType[]) => {
    if (pendingRateChange === null) return false
    appendScheduleEvent(labels, types, `Изменение ставки · ${pendingRateChange}% годовых`, 'rateChange')
    pendingRateChange = null
    return config.paymentType === 'annuity'
  }
  const effectiveAnnualRate = (date: string) =>
    config.rateChangeMode === 'exactDate' ? rateTimeline.rateAt(date, currentAnnualRate) : currentAnnualRate
  const updateEffectiveTerm = (remainingPeriods: number, afterCurrentPayment: boolean, annualRate = currentAnnualRate) => {
    const previousRemainingPeriods = currentRemainingPeriods
    const periods = estimateRemainingPeriods(config, balance, payment, principalPerPeriod, remainingPeriods, annualRate)
    currentRemainingPeriods = afterCurrentPayment ? periods + 1 : periods
    return currentRemainingPeriods !== previousRemainingPeriods
  }
  const applyEarly = (early: EarlyRepayment, interestDue: Decimal, remainingPeriods: number, amountOverride?: Decimal.Value, afterCurrentPayment = false) => {
    const strategy = options.forcedStrategy ?? early.strategy
    const earlyAmount = Decimal.max(0, amountOverride ?? early.amount)
    const requestedAmount = new Decimal(early.amount)
    const regularPaymentApplied = Decimal.max(0, requestedAmount.minus(earlyAmount))
    const regularOutcomePart = regularPaymentApplied.gt(0)
      ? { regularPaymentApplied: num(regularPaymentApplied, config.rounding) }
      : {}
    if (balance.lte(0) && interestDue.lte(0)) {
      const outcome: RepaymentApplicationOutcome = {
        repaymentId: early.id,
        date: early.date,
        requestedAmount: num(requestedAmount, config.rounding),
        ...regularOutcomePart,
        appliedAmount: 0,
        appliedInterest: 0,
        appliedPrincipal: 0,
        fee: 0,
        unusedAmount: num(earlyAmount, config.rounding),
        reason: 'debtClosed'
      }
      return {
        paidInterest: new Decimal(0),
        paidPrincipal: new Decimal(0),
        interestLeft: new Decimal(0),
        fee: new Decimal(0),
        outcome,
        event: { label: 'Операция пропущена · долг уже закрыт', type: 'earlyIgnored' as const },
        paymentRecalculated: false,
        fullyClosedByEarlyRepayment: false,
        comment: early.comment ? `${early.comment} · пропущено: долг уже закрыт` : 'Пропущено: долг уже закрыт'
      }
    }
    const annualRateAtEvent = effectiveAnnualRate(early.date)
    const fee = money(earlyAmount.mul(config.earlyRepaymentFeePercent).div(100), config.rounding)
    let available = Decimal.max(0, earlyAmount.minus(fee))
    const paidInterest = early.interestFirst ? Decimal.min(interestDue, available) : new Decimal(0)
    const interestLeft = interestDue.minus(paidInterest)
    available = available.minus(paidInterest)
    const paidPrincipal = Decimal.min(balance, available)
    balance = clampDebtBalance(balance.minus(paidPrincipal))
    const fullyClosed = balance.isZero() && interestLeft.lte(0)
    const appliedAmount = paidInterest.add(paidPrincipal)
    const unusedAmount = Decimal.max(0, earlyAmount.minus(fee).minus(appliedAmount))
    if (strategy === 'reducePayment' && balance.gt(0) && config.paymentType === 'annuity') {
      const periods = Math.max(1, remainingPeriods)
      const recalculatedPayment = calculateAnnuityPayment(balance, annualRateAtEvent, periods, periodsPerYear(config.frequency), config.rounding)
      const rateChangedInsidePeriod = annualRateAtEvent !== currentAnnualRate
      if (rateChangedInsidePeriod || !paymentTracksReducedTerm) {
        payment = recalculatedPayment
        paymentTracksReducedTerm = false
      } else {
        const paymentDecrease = calculateAnnuityPayment(paidPrincipal, annualRateAtEvent, periods, periodsPerYear(config.frequency), config.rounding)
        payment = money(Decimal.max(0, payment.minus(paymentDecrease)), config.rounding)
      }
    } else if (strategy === 'reducePayment' && balance.gt(0)) {
      const periods = Math.max(1, remainingPeriods)
      const recalculatedPrincipal = money(balance.div(periods), config.rounding)
      if (!paymentTracksReducedTerm) {
        principalPerPeriod = recalculatedPrincipal
      } else {
        const principalDecrease = money(paidPrincipal.div(periods), config.rounding)
        principalPerPeriod = money(Decimal.max(0, principalPerPeriod.minus(principalDecrease)), config.rounding)
      }
    }
    if (strategy === 'reduceTerm' && paidPrincipal.gt(0)) {
      paymentTracksReducedTerm = updateEffectiveTerm(remainingPeriods, afterCurrentPayment, annualRateAtEvent) || paymentTracksReducedTerm
    }
    return {
      paidInterest,
      paidPrincipal,
      interestLeft,
      fee,
      outcome: {
        repaymentId: early.id,
        date: early.date,
        requestedAmount: num(requestedAmount, config.rounding),
        ...regularOutcomePart,
        appliedAmount: num(appliedAmount, config.rounding),
        appliedInterest: num(paidInterest, config.rounding),
        appliedPrincipal: num(paidPrincipal, config.rounding),
        fee: num(fee, config.rounding),
        unusedAmount: num(unusedAmount, config.rounding),
        reason: unusedAmount.gt(0) ? 'partiallyApplied' as const : 'applied' as const
      },
      event: earlyRepaymentEventInfo(strategy, fullyClosed),
      paymentRecalculated: strategy === 'reducePayment' && balance.gt(0),
      fullyClosedByEarlyRepayment: fullyClosed,
      comment: early.comment ?? ''
    }
  }
  const countsAsTotalWithFee = (early: EarlyRepayment, isRegularDateContext: boolean) =>
    isTotalWithFeeAmountMode(early.amountMode) || (early.amountMode === undefined && isRegularDateContext)
  const effectiveAmountAfterRegularPayment = (early: EarlyRepayment, regularPaymentAmount: Decimal.Value, isRegularDateContext: boolean, allowPartialRegularPayment = false) => {
    if (!countsAsTotalWithFee(early, isRegularDateContext)) return undefined
    const totalAmount = new Decimal(early.amount)
    const expectedRegularPayment = Decimal.max(0, regularPaymentAmount)
    if (!allowPartialRegularPayment && totalAmount.lt(expectedRegularPayment)) {
      throw new Error(`Досрочный платёж ${early.date}: общая сумма списания с учётом комиссии должна быть не меньше обязательного платежа ${num(expectedRegularPayment, config.rounding)}`)
    }
    const regularPart = allowPartialRegularPayment ? Decimal.min(totalAmount, expectedRegularPayment) : expectedRegularPayment
    return totalAmount.minus(regularPart)
  }
  const applyEarlyAfterRegularPayment = (
    early: EarlyRepayment,
    interestDue: Decimal,
    remainingPeriods: number,
    regularPaymentAmount: Decimal.Value,
    isRegularDateContext: boolean,
    applyOptions: { afterCurrentPayment?: boolean; allowPartialRegularPayment?: boolean } = {}
  ) => {
    const effectiveAmount = effectiveAmountAfterRegularPayment(
      early,
      regularPaymentAmount,
      isRegularDateContext,
      applyOptions.allowPartialRegularPayment ?? false
    )
    return applyEarly(early, interestDue, remainingPeriods, effectiveAmount, applyOptions.afterCurrentPayment ?? false)
  }

  const iterationLimit = Math.min(MAX_SCHEDULE_ROWS - 1, Math.max(maxPeriods + 240, 360))
  for (let regularIndex = 1; regularIndex <= iterationLimit && (balance.gt(0) || deferredInterest.gt(0)); regularIndex++) {
    const periodCalendarDays = Math.max(1, periodDays(previousPaymentDate, paymentDate, false))
    const exactRateChanges = config.rateChangeMode === 'exactDate' ? rateTimeline.sortedChanges : []
    const accrueSegments = (from: string, to: string, includeTo: boolean, currentBalance: Decimal, reason = 'Начисление процентов') =>
      accrueInterestSegmentsRaw(config, currentBalance, from, to, includeTo, periodCalendarDays, gracePeriods, reason, currentAnnualRate, exactRateChanges, true)
    const sumRawInterest = (segments: ReturnType<typeof accrueSegments>) =>
      segments.reduce((sum, segment) => sum.add(segment.rawInterest), new Decimal(0))
    const roundRawInterest = (segments: ReturnType<typeof accrueSegments>) => money(sumRawInterest(segments), config.rounding)
    const audit = (from: string, to: string, includeTo: boolean, currentBalance: Decimal, order: string, segments: ReturnType<typeof accrueSegments>) => ({
      periodStart: from,
      periodEnd: to,
      regularPeriodStart: previousPaymentDate,
      regularPeriodEnd: paymentDate,
      regularPeriodDays: periodCalendarDays,
      segmentStart: from,
      segmentEnd: to,
      segmentDays: periodDays(from, to, includeTo, shouldExcludeStartDate(config)),
      days: segments.reduce((sum, segment) => sum + segment.days, 0),
      interestMethod: config.interest.method,
      dayCountBasis: config.interest.dayCountBasis,
      interestBalance: num(segments[0]?.balance ?? currentBalance, config.rounding),
      interestBeforeRounding: sumRawInterest(segments).toNumber(),
      interestSegments: segments.map(segment => ({
        from: segment.from,
        to: segment.to,
        days: segment.days,
        balance: num(segment.balance, config.rounding),
        annualRate: segment.annualRate,
        rateBasis: config.interest.dayCountBasis,
        rawInterest: segment.rawInterest.toNumber(),
        reason: segment.reason
      })),
      rounding: config.rounding,
      operationOrder: order
    })
    const auditDays = (segments: ReturnType<typeof accrueSegments>, fallback: number) =>
      segments.length > 0 ? segments.reduce((sum, segment) => sum + segment.days, 0) : fallback

    // Events on arbitrary dates become independent rows. Events sharing one
    // date are combined without accruing a fictitious extra day between them.
    while (repaymentIndex < repayments.length && repayments[repaymentIndex].date < paymentDate) {
      const eventDate = repayments[repaymentIndex].date
      const sameDate: EarlyRepayment[] = []
      while (repaymentIndex < repayments.length && repayments[repaymentIndex].date === eventDate) sameDate.push(repayments[repaymentIndex++])
      if (eventDate < accrualStart) continue

      const opening = balance
      const rowStart = accrualStart
      const includeEventDay = config.interest.includePaymentDate && config.interest.balanceMoment === 'startOfDay'
      const interestSegments = accrueSegments(rowStart, eventDate, includeEventDay, balance, 'Начисление до досрочного погашения')
      let auditInterestSegments = [...interestSegments]
      let chargedInterest = roundRawInterest(interestSegments)
      const deferredOpening = deferredInterest
      let interestDue = deferredInterest.add(chargedInterest)
      deferredInterest = new Decimal(0)
      let earlyTotal = new Decimal(0)
      let earlyPrincipal = new Decimal(0)
      let earlyInterest = new Decimal(0)
      let fees = new Decimal(0)
      const eventLabels: string[] = []
      const eventTypes: ScheduleEventType[] = []
      let paymentRecalculated = appendPendingRateChange(eventLabels, eventTypes)
      let fullyClosedByEarlyRepayment = false
      const comments: string[] = []
      const repaymentOutcomes: RepaymentApplicationOutcome[] = []

      for (const early of sameDate) {
        const applied = applyEarly(early, interestDue, periodsBeforeCurrentPayment(currentRemainingPeriods))
        interestDue = applied.interestLeft
        earlyTotal = earlyTotal.add(applied.paidInterest).add(applied.paidPrincipal)
        earlyPrincipal = earlyPrincipal.add(applied.paidPrincipal)
        earlyInterest = earlyInterest.add(applied.paidInterest)
        fees = fees.add(applied.fee)
        appendScheduleEvent(eventLabels, eventTypes, applied.event.label, applied.event.type)
        paymentRecalculated = paymentRecalculated || applied.paymentRecalculated
        fullyClosedByEarlyRepayment = fullyClosedByEarlyRepayment || applied.fullyClosedByEarlyRepayment
        repaymentOutcomes.push(applied.outcome)
        if (applied.comment) comments.push(applied.comment)
      }
      if (interestDue.gt(0)) deferredInterest = deferredInterest.add(interestDue)

      if (config.interest.includePaymentDate && config.interest.balanceMoment === 'endOfDay' && balance.gt(0)) {
        const endDaySegments = accrueInterestSegmentsRaw({ ...config, interest: { ...config.interest, periodStart: 'inclusive' } }, balance, eventDate, iso(addDays(parseISO(eventDate), 1)), false, periodCalendarDays, gracePeriods, 'Начисление на конец дня', currentAnnualRate, exactRateChanges, true)
        const endDayInterest = roundRawInterest(endDaySegments)
        chargedInterest = chargedInterest.add(endDayInterest)
        auditInterestSegments = [...auditInterestSegments, ...endDaySegments]
        deferredInterest = deferredInterest.add(endDayInterest)
        accrualStart = nextAccrualStartDate(config, eventDate, true)
      } else {
        accrualStart = nextAccrualStartDate(config, eventDate, includeEventDay)
      }

      cumulativeInterest = cumulativeInterest.add(chargedInterest)
      const cashFlowTotal = earlyTotal.add(fees)
      const rowDays = auditDays(auditInterestSegments, periodDays(rowStart, eventDate, includeEventDay, shouldExcludeStartDate(config)))
      pushScheduleRow({
        number: ++rowNumber, date: eventDate, days: rowDays,
        openingBalance: num(opening, config.rounding), payment: 0, interest: num(chargedInterest, config.rounding), principal: num(earlyPrincipal, config.rounding),
        earlyPayment: num(earlyTotal, config.rounding), closingBalance: num(balance, config.rounding),
        interestAccrued: num(chargedInterest, config.rounding), interestPaid: num(earlyInterest, config.rounding), principalPaid: num(earlyPrincipal, config.rounding),
        feePaid: num(fees, config.rounding), deferredInterestOpening: num(deferredOpening, config.rounding), deferredInterestClosing: num(deferredInterest, config.rounding), cashFlowTotal: num(cashFlowTotal, config.rounding),
        cumulativeInterest: num(cumulativeInterest, config.rounding), cumulativeSavings: 0, fee: num(fees, config.rounding),
        comment: comments.join('; '), event: eventLabels.join('; '),
        eventTypes, paymentRecalculated, fullyClosedByEarlyRepayment, isRegularPayment: false, isGracePayment: false,
        audit: audit(rowStart, eventDate, includeEventDay, opening, 'Досрочное погашение между регулярными платежами', auditInterestSegments),
        repaymentOutcomes
      })
    }

    if (balance.lte(0) && deferredInterest.lte(0)) break

    const opening = balance
    const rowStart = accrualStart
    const days = periodDays(rowStart, paymentDate, config.interest.includePaymentDate && config.interest.balanceMoment === 'startOfDay', shouldExcludeStartDate(config))
    const grace = activeGrace(paymentDate, gracePeriods)
    const includeFinalDay = config.interest.includePaymentDate && config.interest.balanceMoment === 'startOfDay'
    const interestSegments = accrueSegments(rowStart, paymentDate, includeFinalDay, balance, 'Начисление до регулярного платежа')
    let auditInterestSegments = [...interestSegments]
    let chargedInterest = roundRawInterest(interestSegments)
    const deferredOpening = deferredInterest
    let interestDue = deferredInterest.add(chargedInterest)
    deferredInterest = new Decimal(0)
    let principalPart = new Decimal(0)
    let paidInterestRegular = new Decimal(0)
    let regularPayment = new Decimal(0)
    let earlyTotal = new Decimal(0)
    let earlyPrincipal = new Decimal(0)
    let earlyInterest = new Decimal(0)
    let earlyFees = new Decimal(0)
    const eventLabels: string[] = []
    const eventTypes: ScheduleEventType[] = []
    let paymentRecalculated = appendPendingRateChange(eventLabels, eventTypes)
    let fullyClosedByEarlyRepayment = false
    const comments: string[] = []
    const repaymentOutcomes: RepaymentApplicationOutcome[] = []
    const sameDay: EarlyRepayment[] = []
    while (repaymentIndex < repayments.length && repayments[repaymentIndex].date === paymentDate) sameDay.push(repayments[repaymentIndex++])
    const earlyFirst = sameDay.filter(r => r.sameDayOrder === 'earlyFirst')
    const regularFirst = sameDay.filter(r => r.sameDayOrder === 'regularFirst')

    for (const early of earlyFirst) {
      const applied = applyEarly(early, interestDue, periodsBeforeCurrentPayment(currentRemainingPeriods))
      interestDue = applied.interestLeft
      earlyTotal = earlyTotal.add(applied.paidInterest).add(applied.paidPrincipal)
      earlyPrincipal = earlyPrincipal.add(applied.paidPrincipal)
      earlyInterest = earlyInterest.add(applied.paidInterest)
      earlyFees = earlyFees.add(applied.fee)
      appendScheduleEvent(eventLabels, eventTypes, applied.event.label, applied.event.type)
      paymentRecalculated = paymentRecalculated || applied.paymentRecalculated
      fullyClosedByEarlyRepayment = fullyClosedByEarlyRepayment || applied.fullyClosedByEarlyRepayment
      repaymentOutcomes.push(applied.outcome)
      if (applied.comment) comments.push(applied.comment)
    }

    if (grace?.type === 'full') {
      if (grace.capitalizeInterest) balance = clampDebtBalance(balance.add(interestDue))
      else deferredInterest = deferredInterest.add(interestDue)
      interestDue = new Decimal(0)
      appendScheduleEvent(eventLabels, eventTypes, 'Льготный период · отсрочка', 'graceFull')
    } else {
      let targetPayment = payment
      if (grace?.type === 'interestOnly' || (regularIndex === 1 && config.firstPaymentInterestOnly !== false)) {
        targetPayment = interestDue
        if (regularIndex === 1 && config.firstPaymentInterestOnly !== false) appendScheduleEvent(eventLabels, eventTypes, 'Первый платёж · только проценты', 'firstInterestOnly')
        else appendScheduleEvent(eventLabels, eventTypes, 'Льготный период · только проценты', 'graceInterestOnly')
      } else if (balance.lte(0) && interestDue.gt(0)) {
        targetPayment = interestDue
        appendScheduleEvent(eventLabels, eventTypes, 'Погашение отложенных процентов', 'deferredInterestPayment')
      } else if (grace?.type === 'reduced' || grace?.type === 'custom') {
        targetPayment = money(grace.paymentAmount ?? payment.div(2), config.rounding)
        appendScheduleEvent(eventLabels, eventTypes, 'Льготный период · особый платёж', 'graceSpecialPayment')
      } else if (config.paymentType === 'differentiated') {
        targetPayment = money(interestDue.add(principalPerPeriod), config.rounding)
      }
      const paidInterest = Decimal.min(interestDue, targetPayment)
      const availableForPrincipal = Decimal.max(0, targetPayment.minus(paidInterest))
      principalPart = Decimal.min(balance, availableForPrincipal)
      balance = clampDebtBalance(balance.minus(principalPart))
      interestDue = interestDue.minus(paidInterest)
      paidInterestRegular = paidInterest
      regularPayment = money(paidInterest.add(principalPart), config.rounding)
      if (interestDue.gt(0) && grace?.capitalizeInterest) {
        balance = clampDebtBalance(balance.add(interestDue))
        interestDue = new Decimal(0)
      }
    }

    for (const early of regularFirst) {
      const applied = applyEarlyAfterRegularPayment(early, interestDue, periodsAfterCurrentPayment(currentRemainingPeriods), regularPayment, true, { afterCurrentPayment: true })
      interestDue = applied.interestLeft
      earlyTotal = earlyTotal.add(applied.paidInterest).add(applied.paidPrincipal)
      earlyPrincipal = earlyPrincipal.add(applied.paidPrincipal)
      earlyInterest = earlyInterest.add(applied.paidInterest)
      earlyFees = earlyFees.add(applied.fee)
      appendScheduleEvent(eventLabels, eventTypes, applied.event.label, applied.event.type)
      paymentRecalculated = paymentRecalculated || applied.paymentRecalculated
      fullyClosedByEarlyRepayment = fullyClosedByEarlyRepayment || applied.fullyClosedByEarlyRepayment
      repaymentOutcomes.push(applied.outcome)
      if (applied.comment) comments.push(applied.comment)
    }

    if ((regularIndex >= maxPeriods || currentRemainingPeriods <= 1) && (balance.gt(0) || interestDue.gt(0) || deferredInterest.gt(0))) {
      const finalAdjustment = balance.add(interestDue).add(deferredInterest)
      const materialityThreshold = Decimal.max(1, Decimal.max(payment, regularPayment).mul(0.05))
      const finalEventType = finalAdjustment.gt(materialityThreshold) ? 'materialBalloon' : 'finalReconciliation'
      const finalInterest = interestDue.add(deferredInterest)
      if (finalInterest.gt(0)) {
        paidInterestRegular = paidInterestRegular.add(finalInterest)
        regularPayment = regularPayment.add(finalInterest)
        interestDue = new Decimal(0)
        deferredInterest = new Decimal(0)
      }
      if (balance.gt(0)) {
        principalPart = principalPart.add(balance)
        regularPayment = regularPayment.add(balance)
        balance = clampDebtBalance(0)
      }
      appendScheduleEvent(
        eventLabels,
        eventTypes,
        finalEventType === 'materialBalloon'
          ? (regularIndex >= maxPeriods ? 'Существенный финальный платёж по договорной дате' : 'Существенный финальный платёж по актуальному сроку')
          : 'Финальная сверка округления',
        finalEventType
      )
    }

    if (interestDue.gt(0)) deferredInterest = deferredInterest.add(interestDue)

    if (config.interest.includePaymentDate && config.interest.balanceMoment === 'endOfDay' && balance.gt(0)) {
      const endDaySegments = accrueInterestSegmentsRaw({ ...config, interest: { ...config.interest, periodStart: 'inclusive' } }, balance, paymentDate, iso(addDays(parseISO(paymentDate), 1)), false, periodCalendarDays, gracePeriods, 'Начисление на конец дня', currentAnnualRate, exactRateChanges, true)
      const endDayInterest = roundRawInterest(endDaySegments)
      chargedInterest = chargedInterest.add(endDayInterest)
      auditInterestSegments = [...auditInterestSegments, ...endDaySegments]
      deferredInterest = deferredInterest.add(endDayInterest)
      accrualStart = nextAccrualStartDate(config, paymentDate, true)
    } else {
      accrualStart = nextAccrualStartDate(config, paymentDate, includeFinalDay)
    }

    if (balance.gt(0) && balance.lte(config.closeThreshold)) {
      principalPart = principalPart.add(balance)
      regularPayment = regularPayment.add(balance)
      balance = clampDebtBalance(0)
      appendScheduleEvent(eventLabels, eventTypes, 'Автозакрытие малого остатка', 'autoClose')
    }
    cumulativeInterest = cumulativeInterest.add(chargedInterest)
    const feePaid = earlyFees.add(config.monthlyFee)
    const principalPaid = principalPart.add(earlyPrincipal)
    const interestPaid = paidInterestRegular.add(earlyInterest)
    const cashFlowTotal = regularPayment.add(earlyTotal).add(feePaid)
    const isGracePayment = eventTypes.some(type => type === 'graceFull' || type === 'graceInterestOnly' || type === 'graceSpecialPayment')
    const isRegularPayment = regularPayment.gt(0) && !isGracePayment && !eventTypes.some(type => type === 'firstInterestOnly' || type === 'deferredInterestPayment' || type === 'materialBalloon')
    const rowDays = auditDays(auditInterestSegments, days)
    pushScheduleRow({
      number: ++rowNumber, date: paymentDate, days: rowDays, openingBalance: num(opening, config.rounding), payment: num(regularPayment, config.rounding),
      interest: num(chargedInterest, config.rounding), principal: num(principalPart.add(earlyPrincipal), config.rounding), earlyPayment: num(earlyTotal, config.rounding),
      closingBalance: num(balance, config.rounding), cumulativeInterest: num(cumulativeInterest, config.rounding), cumulativeSavings: 0,
      interestAccrued: num(chargedInterest, config.rounding), interestPaid: num(interestPaid, config.rounding), principalPaid: num(principalPaid, config.rounding),
      feePaid: num(feePaid, config.rounding), deferredInterestOpening: num(deferredOpening, config.rounding), deferredInterestClosing: num(deferredInterest, config.rounding), cashFlowTotal: num(cashFlowTotal, config.rounding),
      fee: num(feePaid, config.rounding),
      comment: comments.join('; '), event: eventLabels.join('; '),
      eventTypes, paymentRecalculated, fullyClosedByEarlyRepayment, isRegularPayment, isGracePayment,
      audit: audit(rowStart, paymentDate, includeFinalDay, opening, sameDay.length ? `${earlyFirst.length ? 'сначала досрочные платежи; ' : ''}регулярный платёж; ${regularFirst.length ? 'затем досрочные платежи' : 'досрочных платежей в дату платежа нет'}` : 'Регулярный платёж', auditInterestSegments),
      repaymentOutcomes
    })
    const nextAnnualRate = rateTimeline.rateAt(paymentDate, currentAnnualRate)
    if (nextAnnualRate !== currentAnnualRate) {
      currentAnnualRate = nextAnnualRate
      if (balance.gt(0)) {
        pendingRateChange = currentAnnualRate
        if (config.paymentType === 'annuity') {
          payment = calculateAnnuityPayment(balance, currentAnnualRate, Math.max(1, periodsAfterCurrentPayment(currentRemainingPeriods)), periodsPerYear(config.frequency), config.rounding)
          paymentTracksReducedTerm = false
        }
      }
    }
    currentRemainingPeriods = Math.max(0, currentRemainingPeriods - 1)
    previousPaymentDate = paymentDate
    paymentDate = nextPaymentDate(paymentDate, config)
  }
  if (balance.gt(0) || deferredInterest.gt(0)) {
    throw new Error(`График не закрывает кредит в допустимое количество строк (${MAX_SCHEDULE_ROWS})`)
  }
  const ignoredAfterCloseOutcomes: RepaymentApplicationOutcome[] = []
  while (repaymentIndex < repayments.length) {
    const early = repayments[repaymentIndex++]
    const applied = applyEarlyAfterRegularPayment(
      early,
      new Decimal(0),
      periodsAfterCurrentPayment(currentRemainingPeriods),
      payment,
      regularRepaymentDates.has(early.date),
      { afterCurrentPayment: true, allowPartialRegularPayment: true }
    )
    ignoredAfterCloseOutcomes.push(applied.outcome)
  }
  const closingRow = schedule.at(-1)
  if (closingRow && ignoredAfterCloseOutcomes.length > 0) {
    closingRow.repaymentOutcomes = [...(closingRow.repaymentOutcomes ?? []), ...ignoredAfterCloseOutcomes]
  }
  return schedule
}
