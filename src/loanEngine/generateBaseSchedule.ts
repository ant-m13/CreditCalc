import Decimal from 'decimal.js'
import { addDays, parseISO } from 'date-fns'
import { accrueInterestSegmentsRaw, periodsPerYear } from './accrual'
import { calculateAnnuityPayment } from './calculateAnnuityPayment'
import { periodDays } from './calculateInterest'
import { iso, nextPaymentDate } from './dates'
import { activeGrace } from './gracePeriod'
import { MAX_EARLY_REPAYMENTS, MAX_GRACE_PERIODS, MAX_SCHEDULE_ROWS } from './limits'
import { rateForNextPeriod } from './rateChanges'
import { money, num } from './rounding'
import type { EarlyRepayment, GracePeriod, LoanConfig, PaymentScheduleItem, RepaymentStrategy, ScheduleEventType } from './types'
import { validateScenario } from './validation'

const totalPeriods = (config: LoanConfig) => config.frequency === 'biweekly' ? Math.max(1, Math.round(config.termMonths * 26 / 12)) : config.frequency === 'quarterly' ? Math.max(1, Math.round(config.termMonths / 3)) : config.termMonths
const extendedPaymentPeriods = (config: LoanConfig, gracePeriods: GracePeriod[]) => {
  const extending = gracePeriods.filter(period => period.extendTerm)
  if (extending.length === 0) return 0
  let count = 0
  let cursor = config.firstPaymentDate
  for (let index = 0; index < totalPeriods(config); index += 1) {
    if (extending.some(period => period.startDate <= cursor && cursor <= period.endDate)) count += 1
    cursor = nextPaymentDate(cursor, config)
  }
  return count
}

interface Options { earlyRepayments?: EarlyRepayment[]; gracePeriods?: GracePeriod[]; forcedStrategy?: RepaymentStrategy }

/**
 * Builds an event-based schedule. An early repayment between two regular due
 * dates is its own row, just as it is in a bank statement: interest is accrued
 * up to the event, the balance changes on that date, and the next interval is
 * calculated from the new balance.
 */
export function generateBaseSchedule(config: LoanConfig, options: Options = {}): PaymentScheduleItem[] {
  const allRepayments = [...(options.earlyRepayments ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const repayments = allRepayments.filter(item => item.enabled !== false && item.amount > 0)
  const gracePeriods = options.gracePeriods ?? []
  if (allRepayments.length > MAX_EARLY_REPAYMENTS) throw new Error(`Слишком много досрочных платежей. Максимум: ${MAX_EARLY_REPAYMENTS}`)
  if (gracePeriods.length > MAX_GRACE_PERIODS) throw new Error(`Слишком много льготных периодов. Максимум: ${MAX_GRACE_PERIODS}`)
  const validationErrors = validateScenario(config, allRepayments, gracePeriods)
  if (validationErrors.length > 0) throw new Error(validationErrors.join(' · '))
  const configuredPeriods = totalPeriods(config)
  const maxPeriods = configuredPeriods + extendedPaymentPeriods(config, gracePeriods)
  let effectiveFinalRegularIndex = maxPeriods
  let balance = money(config.principal, config.rounding)
  let principalPerPeriod = money(new Decimal(balance).div(Math.max(1, configuredPeriods)), config.rounding)
  let currentAnnualRate = config.annualRate
  let payment = config.paymentType === 'annuity' ? calculateAnnuityPayment(balance, currentAnnualRate, configuredPeriods, periodsPerYear(config.frequency), config.rounding) : principalPerPeriod
  let paymentDate = config.firstPaymentDate
  let previousPaymentDate = config.issueDate
  let accrualStart = config.issueDate
  let cumulativeInterest = new Decimal(0)
  let deferredInterest = new Decimal(0)
  let repaymentIndex = 0
  let rowNumber = 1
  let hasTermReduction = false
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
  const pushScheduleRow = (row: PaymentScheduleItem) => {
    if (schedule.length >= MAX_SCHEDULE_ROWS) {
      throw new Error(`График не закрывает кредит в допустимое количество строк (${MAX_SCHEDULE_ROWS})`)
    }
    schedule.push(row)
  }
  const appendUnique = <T,>(items: T[], item: T) => {
    if (!items.includes(item)) items.push(item)
  }
  const appendEvent = (labels: string[], types: ScheduleEventType[], label: string, type: ScheduleEventType) => {
    appendUnique(labels, label)
    appendUnique(types, type)
  }
  const appendPendingRateChange = (labels: string[], types: ScheduleEventType[]) => {
    if (pendingRateChange === null) return false
    appendEvent(labels, types, `Изменение ставки · ${pendingRateChange}% годовых`, 'rateChange')
    pendingRateChange = null
    return config.paymentType === 'annuity'
  }
  const excludeStartDate = () => config.interest.periodStart === 'exclusive'
  const nextAccrualStart = (date: string, includedEndDate: boolean) =>
    includedEndDate && !excludeStartDate() ? iso(addDays(parseISO(date), 1)) : date
  const eventInfo = (strategy: RepaymentStrategy, fullyClosed: boolean) => {
    if (strategy === 'reduceTerm') return { label: 'Пересчёт · сокращение срока', type: 'earlyReduceTerm' as const }
    if (strategy === 'reducePayment') return { label: 'Пересчёт · уменьшение платежа', type: 'earlyReducePayment' as const }
    if (strategy === 'full') return fullyClosed
      ? { label: 'Полное досрочное погашение', type: 'earlyFull' as const }
      : { label: 'Полное погашение · недостаточно средств', type: 'earlyFullInsufficient' as const }
    return { label: 'Комбинированный пересчёт', type: 'earlyCombined' as const }
  }
  const remainingPeriodsBeforeCurrentPayment = (regularIndex: number) => Math.max(1, effectiveFinalRegularIndex - regularIndex + 1)
  const remainingPeriodsAfterCurrentPayment = (regularIndex: number) => Math.max(0, effectiveFinalRegularIndex - regularIndex)
  const estimateRemainingPeriods = (fallback: number) => {
    const fallbackPeriods = Math.max(1, Math.ceil(fallback))
    if (balance.lte(0)) return 0
    if (config.paymentType === 'differentiated') {
      if (principalPerPeriod.lte(0)) return fallbackPeriods
      return Math.min(fallbackPeriods, Math.max(1, Math.ceil(balance.div(principalPerPeriod).toNumber())))
    }
    if (payment.lte(0)) return fallbackPeriods
    const rate = new Decimal(currentAnnualRate).div(100).div(periodsPerYear(config.frequency))
    if (rate.isZero()) return Math.min(fallbackPeriods, Math.max(1, Math.ceil(balance.div(payment).toNumber())))
    if (payment.lte(balance.mul(rate))) return fallbackPeriods
    const ratio = new Decimal(1).minus(balance.mul(rate).div(payment))
    const exactPeriods = ratio.gt(0) && ratio.lt(1) ? -Math.log(ratio.toNumber()) / Math.log(rate.add(1).toNumber()) : Number.NaN
    if (!Number.isFinite(exactPeriods) || exactPeriods <= 0) return fallbackPeriods
    return Math.min(fallbackPeriods, Math.max(1, Math.ceil(exactPeriods)))
  }
  const updateEffectiveTerm = (regularIndex: number, remainingPeriods: number, afterCurrentPayment: boolean) => {
    const periods = estimateRemainingPeriods(remainingPeriods)
    if (periods <= 0) {
      effectiveFinalRegularIndex = Math.min(effectiveFinalRegularIndex, regularIndex)
      return
    }
    effectiveFinalRegularIndex = afterCurrentPayment ? regularIndex + periods : regularIndex + periods - 1
  }

  const iterationLimit = Math.min(MAX_SCHEDULE_ROWS - 1, Math.max(maxPeriods + 240, 360))
  for (let regularIndex = 1; regularIndex <= iterationLimit && (balance.gt(0) || deferredInterest.gt(0)); regularIndex++) {
    const periodCalendarDays = Math.max(1, periodDays(previousPaymentDate, paymentDate, false))
    const exactRateChanges = config.rateChangeMode === 'exactDate' ? config.rateChanges : []
    const accrueSegments = (from: string, to: string, includeTo: boolean, currentBalance: Decimal, reason = 'Начисление процентов') =>
      accrueInterestSegmentsRaw(config, currentBalance, from, to, includeTo, periodCalendarDays, gracePeriods, reason, currentAnnualRate, exactRateChanges)
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
      segmentDays: periodDays(from, to, includeTo, excludeStartDate()),
      days: segments.reduce((sum, segment) => sum + segment.days, 0),
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

    const applyEarly = (early: EarlyRepayment, interestDue: Decimal, remainingPeriods: number, amountOverride?: Decimal.Value, afterCurrentPayment = false) => {
      const strategy = options.forcedStrategy ?? early.strategy
      const earlyAmount = Decimal.max(0, amountOverride ?? early.amount)
      const fee = money(earlyAmount.mul(config.earlyRepaymentFeePercent).div(100), config.rounding)
      let available = Decimal.max(0, earlyAmount.minus(fee))
      const paidInterest = early.interestFirst ? Decimal.min(interestDue, available) : new Decimal(0)
      const interestLeft = interestDue.minus(paidInterest)
      available = available.minus(paidInterest)
      const paidPrincipal = Decimal.min(balance, available)
      balance = Decimal.max(0, balance.minus(paidPrincipal))
      const fullyClosed = balance.isZero() && interestLeft.lte(0)
      if (strategy === 'reducePayment' && balance.gt(0) && config.paymentType === 'annuity') {
        payment = hasTermReduction
          ? money(Decimal.max(0, payment.minus(calculateAnnuityPayment(paidPrincipal, currentAnnualRate, Math.max(1, remainingPeriods), periodsPerYear(config.frequency), config.rounding))), config.rounding)
          : calculateAnnuityPayment(balance, currentAnnualRate, Math.max(1, remainingPeriods), periodsPerYear(config.frequency), config.rounding)
      } else if (strategy === 'reducePayment' && balance.gt(0)) {
        principalPerPeriod = hasTermReduction
          ? money(Decimal.max(0, principalPerPeriod.minus(money(paidPrincipal.div(Math.max(1, remainingPeriods)), config.rounding))), config.rounding)
          : money(balance.div(Math.max(1, remainingPeriods)), config.rounding)
      }
      if (strategy === 'reduceTerm' && paidPrincipal.gt(0)) {
        hasTermReduction = true
        updateEffectiveTerm(regularIndex, remainingPeriods, afterCurrentPayment)
      }
      return {
        paidInterest,
        paidPrincipal,
        interestLeft,
        fee,
        event: eventInfo(strategy, fullyClosed),
        paymentRecalculated: strategy === 'reducePayment' && balance.gt(0),
        fullyClosedByEarlyRepayment: strategy === 'full' && fullyClosed,
        comment: early.comment ?? ''
      }
    }

    // Events on arbitrary dates become independent rows. Events sharing one
    // date are combined without accruing a fictitious extra day between them.
    while (repaymentIndex < repayments.length && repayments[repaymentIndex].date < paymentDate) {
      const eventDate = repayments[repaymentIndex].date
      const sameDate: EarlyRepayment[] = []
      while (repaymentIndex < repayments.length && repayments[repaymentIndex].date === eventDate) sameDate.push(repayments[repaymentIndex++])
      if (eventDate < accrualStart) continue

      const opening = balance
      const includeEventDay = config.interest.includePaymentDate && config.interest.balanceMoment === 'startOfDay'
      const interestSegments = accrueSegments(accrualStart, eventDate, includeEventDay, balance, 'Начисление до досрочного погашения')
      const chargedInterest = roundRawInterest(interestSegments)
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

      for (const early of sameDate) {
        const applied = applyEarly(early, interestDue, remainingPeriodsBeforeCurrentPayment(regularIndex))
        interestDue = applied.interestLeft
        earlyTotal = earlyTotal.add(applied.paidInterest).add(applied.paidPrincipal)
        earlyPrincipal = earlyPrincipal.add(applied.paidPrincipal)
        earlyInterest = earlyInterest.add(applied.paidInterest)
        fees = fees.add(applied.fee)
        appendEvent(eventLabels, eventTypes, applied.event.label, applied.event.type)
        paymentRecalculated = paymentRecalculated || applied.paymentRecalculated
        fullyClosedByEarlyRepayment = fullyClosedByEarlyRepayment || applied.fullyClosedByEarlyRepayment
        if (applied.comment) comments.push(applied.comment)
      }
      if (interestDue.gt(0)) deferredInterest = deferredInterest.add(interestDue)
      cumulativeInterest = cumulativeInterest.add(chargedInterest)
      const cashFlowTotal = earlyTotal.add(fees)
      pushScheduleRow({
        number: ++rowNumber, date: eventDate, days: periodDays(accrualStart, eventDate, includeEventDay, excludeStartDate()),
        openingBalance: num(opening, config.rounding), payment: 0, interest: num(chargedInterest, config.rounding), principal: num(earlyPrincipal, config.rounding),
        earlyPayment: num(earlyTotal, config.rounding), closingBalance: num(balance, config.rounding),
        interestAccrued: num(chargedInterest, config.rounding), interestPaid: num(earlyInterest, config.rounding), principalPaid: num(earlyPrincipal, config.rounding),
        feePaid: num(fees, config.rounding), deferredInterestOpening: num(deferredOpening, config.rounding), deferredInterestClosing: num(deferredInterest, config.rounding), cashFlowTotal: num(cashFlowTotal, config.rounding),
        cumulativeInterest: num(cumulativeInterest, config.rounding), cumulativeSavings: 0, fee: num(fees, config.rounding),
        comment: comments.join('; '), event: eventLabels.join('; '),
        eventTypes, paymentRecalculated, fullyClosedByEarlyRepayment, isRegularPayment: false, isGracePayment: false,
        audit: audit(accrualStart, eventDate, includeEventDay, opening, 'Досрочное погашение между регулярными платежами', interestSegments)
      })
      accrualStart = nextAccrualStart(eventDate, includeEventDay)
    }

    if (balance.lte(0) && deferredInterest.lte(0)) break

    const opening = balance
    const rowStart = accrualStart
    const days = periodDays(rowStart, paymentDate, config.interest.includePaymentDate && config.interest.balanceMoment === 'startOfDay', excludeStartDate())
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
    const sameDay: EarlyRepayment[] = []
    while (repaymentIndex < repayments.length && repayments[repaymentIndex].date === paymentDate) sameDay.push(repayments[repaymentIndex++])
    const earlyFirst = sameDay.filter(r => r.sameDayOrder === 'earlyFirst')
    const regularFirst = sameDay.filter(r => r.sameDayOrder === 'regularFirst')

    for (const early of earlyFirst) {
      const applied = applyEarly(early, interestDue, remainingPeriodsBeforeCurrentPayment(regularIndex))
      interestDue = applied.interestLeft
      earlyTotal = earlyTotal.add(applied.paidInterest).add(applied.paidPrincipal)
      earlyPrincipal = earlyPrincipal.add(applied.paidPrincipal)
      earlyInterest = earlyInterest.add(applied.paidInterest)
      earlyFees = earlyFees.add(applied.fee)
      appendEvent(eventLabels, eventTypes, applied.event.label, applied.event.type)
      paymentRecalculated = paymentRecalculated || applied.paymentRecalculated
      fullyClosedByEarlyRepayment = fullyClosedByEarlyRepayment || applied.fullyClosedByEarlyRepayment
      if (applied.comment) comments.push(applied.comment)
    }

    if (grace?.type === 'full') {
      if (grace.capitalizeInterest) balance = balance.add(interestDue)
      else deferredInterest = deferredInterest.add(interestDue)
      interestDue = new Decimal(0)
      appendEvent(eventLabels, eventTypes, 'Льготный период · отсрочка', 'graceFull')
    } else {
      let targetPayment = payment
      if (grace?.type === 'interestOnly' || (regularIndex === 1 && config.firstPaymentInterestOnly !== false)) {
        targetPayment = interestDue
        if (regularIndex === 1 && config.firstPaymentInterestOnly !== false) appendEvent(eventLabels, eventTypes, 'Первый платёж · только проценты', 'firstInterestOnly')
        else appendEvent(eventLabels, eventTypes, 'Льготный период · только проценты', 'graceInterestOnly')
      } else if (balance.lte(0) && interestDue.gt(0)) {
        targetPayment = interestDue
        appendEvent(eventLabels, eventTypes, 'Погашение отложенных процентов', 'deferredInterestPayment')
      } else if (grace?.type === 'reduced' || grace?.type === 'custom') {
        targetPayment = money(grace.paymentAmount ?? payment.div(2), config.rounding)
        appendEvent(eventLabels, eventTypes, 'Льготный период · особый платёж', 'graceSpecialPayment')
      } else if (config.paymentType === 'differentiated') {
        targetPayment = money(interestDue.add(principalPerPeriod), config.rounding)
      }
      const paidInterest = Decimal.min(interestDue, targetPayment)
      const availableForPrincipal = Decimal.max(0, targetPayment.minus(paidInterest))
      principalPart = Decimal.min(balance, availableForPrincipal)
      balance = Decimal.max(0, balance.minus(principalPart))
      interestDue = interestDue.minus(paidInterest)
      paidInterestRegular = paidInterest
      regularPayment = money(paidInterest.add(principalPart), config.rounding)
    }

    for (const early of regularFirst) {
      // Older saved bank rows have no amountMode. Treat them as the total paid
      // on that date; explicit "extra" records preserve the previous behavior.
      let effectiveAmount: Decimal | undefined
      if (early.amountMode !== 'extra') {
        const totalAmount = new Decimal(early.amount)
        if (totalAmount.lt(regularPayment)) {
          throw new Error(`Досрочный платёж ${early.date}: общая сумма по телу и процентам без комиссий должна быть не меньше обязательного платежа ${num(regularPayment, config.rounding)}`)
        }
        effectiveAmount = totalAmount.minus(regularPayment)
      }
      const applied = applyEarly(early, interestDue, remainingPeriodsAfterCurrentPayment(regularIndex), effectiveAmount, true)
      interestDue = applied.interestLeft
      earlyTotal = earlyTotal.add(applied.paidInterest).add(applied.paidPrincipal)
      earlyPrincipal = earlyPrincipal.add(applied.paidPrincipal)
      earlyInterest = earlyInterest.add(applied.paidInterest)
      earlyFees = earlyFees.add(applied.fee)
      appendEvent(eventLabels, eventTypes, applied.event.label, applied.event.type)
      paymentRecalculated = paymentRecalculated || applied.paymentRecalculated
      fullyClosedByEarlyRepayment = fullyClosedByEarlyRepayment || applied.fullyClosedByEarlyRepayment
      if (applied.comment) comments.push(applied.comment)
    }

    if (regularIndex >= maxPeriods && (balance.gt(0) || interestDue.gt(0) || deferredInterest.gt(0))) {
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
        balance = new Decimal(0)
      }
      appendEvent(eventLabels, eventTypes, 'Финальный платёж по договорной дате', 'finalBalloon')
    }

    if (interestDue.gt(0)) deferredInterest = deferredInterest.add(interestDue)

    if (config.interest.includePaymentDate && config.interest.balanceMoment === 'endOfDay' && balance.gt(0)) {
      const endDaySegments = accrueInterestSegmentsRaw({ ...config, interest: { ...config.interest, periodStart: 'inclusive' } }, balance, paymentDate, iso(addDays(parseISO(paymentDate), 1)), false, periodCalendarDays, gracePeriods, 'Начисление на конец дня', currentAnnualRate, exactRateChanges)
      const endDayInterest = roundRawInterest(endDaySegments)
      chargedInterest = chargedInterest.add(endDayInterest)
      auditInterestSegments = [...auditInterestSegments, ...endDaySegments]
      deferredInterest = deferredInterest.add(endDayInterest)
      accrualStart = nextAccrualStart(paymentDate, true)
    } else {
      accrualStart = nextAccrualStart(paymentDate, includeFinalDay)
    }

    if (balance.gt(0) && balance.lte(config.closeThreshold)) {
      principalPart = principalPart.add(balance)
      regularPayment = regularPayment.add(balance)
      balance = new Decimal(0)
      appendEvent(eventLabels, eventTypes, 'Автозакрытие малого остатка', 'autoClose')
    }
    cumulativeInterest = cumulativeInterest.add(chargedInterest)
    const feePaid = earlyFees.add(config.monthlyFee)
    const principalPaid = principalPart.add(earlyPrincipal)
    const interestPaid = paidInterestRegular.add(earlyInterest)
    const cashFlowTotal = regularPayment.add(earlyTotal).add(feePaid)
    const isGracePayment = eventTypes.some(type => type === 'graceFull' || type === 'graceInterestOnly' || type === 'graceSpecialPayment')
    const isRegularPayment = regularPayment.gt(0) && !isGracePayment && !eventTypes.some(type => type === 'firstInterestOnly' || type === 'deferredInterestPayment' || type === 'finalBalloon')
    pushScheduleRow({
      number: ++rowNumber, date: paymentDate, days, openingBalance: num(opening, config.rounding), payment: num(regularPayment, config.rounding),
      interest: num(chargedInterest, config.rounding), principal: num(principalPart.add(earlyPrincipal), config.rounding), earlyPayment: num(earlyTotal, config.rounding),
      closingBalance: num(balance, config.rounding), cumulativeInterest: num(cumulativeInterest, config.rounding), cumulativeSavings: 0,
      interestAccrued: num(chargedInterest, config.rounding), interestPaid: num(interestPaid, config.rounding), principalPaid: num(principalPaid, config.rounding),
      feePaid: num(feePaid, config.rounding), deferredInterestOpening: num(deferredOpening, config.rounding), deferredInterestClosing: num(deferredInterest, config.rounding), cashFlowTotal: num(cashFlowTotal, config.rounding),
      fee: num(feePaid, config.rounding),
      comment: comments.join('; '), event: eventLabels.join('; '),
      eventTypes, paymentRecalculated, fullyClosedByEarlyRepayment, isRegularPayment, isGracePayment,
      audit: audit(rowStart, paymentDate, includeFinalDay, opening, sameDay.length ? `${earlyFirst.length ? 'сначала досрочные платежи; ' : ''}регулярный платёж; ${regularFirst.length ? 'затем досрочные платежи' : 'досрочных платежей в дату платежа нет'}` : 'Регулярный платёж', auditInterestSegments)
    })
    const nextAnnualRate = rateForNextPeriod(config, paymentDate, currentAnnualRate)
    if (nextAnnualRate !== currentAnnualRate) {
      currentAnnualRate = nextAnnualRate
      if (balance.gt(0)) {
        pendingRateChange = currentAnnualRate
        if (config.paymentType === 'annuity') {
          payment = calculateAnnuityPayment(balance, currentAnnualRate, Math.max(1, remainingPeriodsAfterCurrentPayment(regularIndex)), periodsPerYear(config.frequency), config.rounding)
        }
      }
    }
    previousPaymentDate = paymentDate
    paymentDate = nextPaymentDate(paymentDate, config)
  }
  if (balance.gt(0) || deferredInterest.gt(0)) {
    throw new Error(`График не закрывает кредит в допустимое количество строк (${MAX_SCHEDULE_ROWS})`)
  }
  return schedule
}
