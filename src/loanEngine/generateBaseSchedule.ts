import Decimal from 'decimal.js'
import { addDays, addMonths, format, getDaysInMonth, parseISO } from 'date-fns'
import { calculateAnnuityPayment } from './calculateAnnuityPayment'
import { calculateInterest, periodDays } from './calculateInterest'
import { activeGrace } from './gracePeriod'
import { money, num } from './rounding'
import type { EarlyRepayment, GracePeriod, LoanConfig, PaymentScheduleItem, RepaymentStrategy } from './types'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const periodsPerYear = (frequency: LoanConfig['frequency']) => frequency === 'biweekly' ? 26 : frequency === 'quarterly' ? 4 : 12
const totalPeriods = (config: LoanConfig) => config.frequency === 'biweekly' ? Math.ceil(config.termMonths * 26 / 12) : config.frequency === 'quarterly' ? Math.ceil(config.termMonths / 3) : config.termMonths

export function nextPaymentDate(date: string, config: LoanConfig) {
  const parsed = parseISO(date)
  if (config.frequency === 'biweekly') return iso(addDays(parsed, 14))
  const offset = config.frequency === 'quarterly' ? 3 : 1
  const target = addMonths(parsed, offset)
  return iso(new Date(target.getFullYear(), target.getMonth(), Math.min(config.paymentDay, getDaysInMonth(target))))
}

interface Options { earlyRepayments?: EarlyRepayment[]; gracePeriods?: GracePeriod[]; forcedStrategy?: RepaymentStrategy }

/**
 * Builds an event-based schedule. An early repayment between two regular due
 * dates is its own row, just as it is in a bank statement: interest is accrued
 * up to the event, the balance changes on that date, and the next interval is
 * calculated from the new balance.
 */
export function generateBaseSchedule(config: LoanConfig, options: Options = {}): PaymentScheduleItem[] {
  const repayments = [...(options.earlyRepayments ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const gracePeriods = options.gracePeriods ?? []
  const configuredPeriods = totalPeriods(config)
  const maxPeriods = configuredPeriods + gracePeriods.filter(g => g.extendTerm).reduce((sum, g) => sum + Math.max(1, Math.ceil((+parseISO(g.endDate) - +parseISO(g.startDate)) / 2629800000)), 0)
  let balance = money(config.principal, config.rounding)
  let payment = config.paymentType === 'annuity' ? calculateAnnuityPayment(balance, config.annualRate, configuredPeriods, periodsPerYear(config.frequency), config.rounding) : money(new Decimal(balance).div(configuredPeriods), config.rounding)
  let paymentDate = config.firstPaymentDate
  let previousPaymentDate = config.issueDate
  let accrualStart = config.issueDate
  let cumulativeInterest = new Decimal(0)
  let deferredInterest = new Decimal(0)
  let repaymentIndex = 0
  let rowNumber = 1
  const schedule: PaymentScheduleItem[] = [{
    number: 1,
    date: config.issueDate,
    days: 0,
    openingBalance: num(balance, config.rounding),
    payment: 0,
    interest: 0,
    principal: 0,
    earlyPayment: 0,
    closingBalance: num(balance, config.rounding),
    cumulativeInterest: 0,
    cumulativeSavings: 0,
    fee: 0,
    comment: '',
    event: 'Выдача кредита'
  }]

  const eventLabel = (strategy: RepaymentStrategy, fullyClosed: boolean) => strategy === 'reduceTerm'
    ? 'Пересчёт · сокращение срока'
    : strategy === 'reducePayment'
      ? 'Пересчёт · уменьшение платежа'
      : strategy === 'full'
        ? (fullyClosed ? 'Полное досрочное погашение' : 'Полное погашение · недостаточно средств')
        : 'Комбинированный пересчёт'

  for (let regularIndex = 1; regularIndex <= Math.max(maxPeriods + 240, 360) && balance.gt(0); regularIndex++) {
    const periodCalendarDays = Math.max(1, periodDays(previousPaymentDate, paymentDate, false))
    const accrueRaw = (from: string, to: string, includeTo: boolean, currentBalance: Decimal) => {
      if (to < from || currentBalance.lte(0)) return new Decimal(0)
      if (config.interest.method === 'daily') {
        return calculateInterest(currentBalance, config.annualRate, from, to, { ...config.interest, includePaymentDate: includeTo })
      }
      const segmentDays = periodDays(from, to, includeTo)
      return currentBalance.mul(config.annualRate).div(100).div(periodsPerYear(config.frequency)).mul(segmentDays).div(periodCalendarDays)
    }
    const accrue = (from: string, to: string, includeTo: boolean, currentBalance: Decimal) => money(accrueRaw(from, to, includeTo, currentBalance), config.rounding)
    const audit = (from: string, to: string, includeTo: boolean, currentBalance: Decimal, order: string) => ({
      periodStart: from,
      periodEnd: to,
      days: periodDays(from, to, includeTo),
      dayCountBasis: config.interest.dayCountBasis,
      interestBalance: num(currentBalance, config.rounding),
      interestBeforeRounding: accrueRaw(from, to, includeTo, currentBalance).toNumber(),
      rounding: config.rounding,
      operationOrder: order
    })

    const applyEarly = (early: EarlyRepayment, interestDue: Decimal, remainingPeriods: number, amountOverride?: Decimal.Value) => {
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
      if (strategy === 'reducePayment' && balance.gt(0)) {
        payment = calculateAnnuityPayment(balance, config.annualRate, Math.max(1, remainingPeriods), periodsPerYear(config.frequency), config.rounding)
      }
      return { paidInterest, paidPrincipal, interestLeft, fee, event: eventLabel(strategy, fullyClosed), comment: early.comment ?? '' }
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
      const chargedInterest = accrue(accrualStart, eventDate, includeEventDay, balance)
      let interestDue = deferredInterest.add(chargedInterest)
      deferredInterest = new Decimal(0)
      let earlyTotal = new Decimal(0)
      let earlyPrincipal = new Decimal(0)
      let fees = new Decimal(0)
      let event = ''
      const comments: string[] = []

      for (const early of sameDate) {
        const applied = applyEarly(early, interestDue, maxPeriods - regularIndex + 1)
        interestDue = applied.interestLeft
        earlyTotal = earlyTotal.add(applied.paidInterest).add(applied.paidPrincipal)
        earlyPrincipal = earlyPrincipal.add(applied.paidPrincipal)
        fees = fees.add(applied.fee)
        event = applied.event
        if (applied.comment) comments.push(applied.comment)
      }
      if (interestDue.gt(0)) deferredInterest = deferredInterest.add(interestDue)
      cumulativeInterest = cumulativeInterest.add(chargedInterest)
      schedule.push({
        number: ++rowNumber, date: eventDate, days: periodDays(accrualStart, eventDate, includeEventDay),
        openingBalance: num(opening, config.rounding), payment: 0, interest: num(chargedInterest, config.rounding), principal: num(earlyPrincipal, config.rounding),
        earlyPayment: num(earlyTotal, config.rounding), closingBalance: num(balance, config.rounding),
        cumulativeInterest: num(cumulativeInterest, config.rounding), cumulativeSavings: 0, fee: num(fees, config.rounding),
        comment: comments.join('; '), event,
        audit: audit(accrualStart, eventDate, includeEventDay, opening, 'Досрочное погашение между регулярными платежами')
      })
      accrualStart = includeEventDay ? iso(addDays(parseISO(eventDate), 1)) : eventDate
    }

    if (balance.lte(0)) break

    const opening = balance
    const rowStart = accrualStart
    const days = periodDays(rowStart, paymentDate, config.interest.includePaymentDate && config.interest.balanceMoment === 'startOfDay')
    const grace = activeGrace(paymentDate, gracePeriods)
    const includeFinalDay = config.interest.includePaymentDate && config.interest.balanceMoment === 'startOfDay'
    let chargedInterest = accrue(rowStart, paymentDate, includeFinalDay, balance)
    let interestDue = deferredInterest.add(chargedInterest)
    deferredInterest = new Decimal(0)
    let principalPart = new Decimal(0)
    let regularPayment = new Decimal(0)
    let earlyTotal = new Decimal(0)
    let earlyPrincipal = new Decimal(0)
    let earlyFees = new Decimal(0)
    let event = ''
    const comments: string[] = []
    const sameDay: EarlyRepayment[] = []
    while (repaymentIndex < repayments.length && repayments[repaymentIndex].date === paymentDate) sameDay.push(repayments[repaymentIndex++])
    const earlyFirst = sameDay.filter(r => r.sameDayOrder === 'earlyFirst')
    const regularFirst = sameDay.filter(r => r.sameDayOrder === 'regularFirst')

    for (const early of earlyFirst) {
      const applied = applyEarly(early, interestDue, maxPeriods - regularIndex + 1)
      interestDue = applied.interestLeft
      earlyTotal = earlyTotal.add(applied.paidInterest).add(applied.paidPrincipal)
      earlyPrincipal = earlyPrincipal.add(applied.paidPrincipal)
      earlyFees = earlyFees.add(applied.fee)
      event = applied.event
      if (applied.comment) comments.push(applied.comment)
    }

    if (grace?.type === 'full') {
      if (!grace.accrueInterest) {
        interestDue = Decimal.max(0, interestDue.minus(chargedInterest))
        chargedInterest = new Decimal(0)
      }
      if (grace.capitalizeInterest) balance = balance.add(interestDue)
      else deferredInterest = deferredInterest.add(interestDue)
      interestDue = new Decimal(0)
      event = event || 'Льготный период · отсрочка'
    } else {
      let targetPayment = payment
      if (grace?.type === 'interestOnly' || (regularIndex === 1 && config.firstPaymentInterestOnly !== false)) {
        targetPayment = interestDue
        event = event || (regularIndex === 1 && config.firstPaymentInterestOnly !== false ? 'Первый платёж · только проценты' : 'Льготный период · только проценты')
      } else if (grace?.type === 'reduced' || grace?.type === 'custom') {
        targetPayment = money(grace.paymentAmount ?? payment.div(2), config.rounding)
        event = event || 'Льготный период · особый платёж'
      } else if (config.paymentType === 'differentiated') {
        targetPayment = money(interestDue.add(new Decimal(config.principal).div(configuredPeriods)), config.rounding)
      }
      const paidInterest = Decimal.min(interestDue, targetPayment)
      const availableForPrincipal = Decimal.max(0, targetPayment.minus(paidInterest))
      principalPart = Decimal.min(balance, availableForPrincipal)
      balance = Decimal.max(0, balance.minus(principalPart))
      interestDue = interestDue.minus(paidInterest)
      regularPayment = money(paidInterest.add(principalPart), config.rounding)
    }

    for (const early of regularFirst) {
      // Older saved bank rows have no amountMode. Treat them as the total paid
      // on that date; explicit "extra" records preserve the previous behavior.
      const effectiveAmount = early.amountMode !== 'extra' ? Decimal.max(0, new Decimal(early.amount).minus(regularPayment)) : undefined
      const applied = applyEarly(early, interestDue, maxPeriods - regularIndex, effectiveAmount)
      interestDue = applied.interestLeft
      earlyTotal = earlyTotal.add(applied.paidInterest).add(applied.paidPrincipal)
      earlyPrincipal = earlyPrincipal.add(applied.paidPrincipal)
      earlyFees = earlyFees.add(applied.fee)
      event = applied.event
      if (applied.comment) comments.push(applied.comment)
    }
    if (interestDue.gt(0)) deferredInterest = deferredInterest.add(interestDue)

    if (config.interest.includePaymentDate && config.interest.balanceMoment === 'endOfDay' && balance.gt(0)) {
      const endDayInterest = accrue(paymentDate, iso(addDays(parseISO(paymentDate), 1)), false, balance)
      chargedInterest = chargedInterest.add(endDayInterest)
      deferredInterest = deferredInterest.add(endDayInterest)
      accrualStart = iso(addDays(parseISO(paymentDate), 1))
    } else {
      accrualStart = includeFinalDay ? iso(addDays(parseISO(paymentDate), 1)) : paymentDate
    }

    if (balance.gt(0) && balance.lte(config.closeThreshold)) {
      principalPart = principalPart.add(balance)
      regularPayment = regularPayment.add(balance)
      balance = new Decimal(0)
      event = event || 'Автозакрытие малого остатка'
    }
    cumulativeInterest = cumulativeInterest.add(chargedInterest)
    schedule.push({
      number: ++rowNumber, date: paymentDate, days, openingBalance: num(opening, config.rounding), payment: num(regularPayment, config.rounding),
      interest: num(chargedInterest, config.rounding), principal: num(principalPart.add(earlyPrincipal), config.rounding), earlyPayment: num(earlyTotal, config.rounding),
      closingBalance: num(balance, config.rounding), cumulativeInterest: num(cumulativeInterest, config.rounding), cumulativeSavings: 0,
      fee: num(earlyFees.add(config.monthlyFee).add(regularIndex === 1 ? config.oneTimeFee : 0), config.rounding),
      comment: comments.join('; '), event,
      audit: audit(rowStart, paymentDate, includeFinalDay, opening, sameDay.length ? `${earlyFirst.length ? 'Сначала досрочные earlyFirst; ' : ''}регулярный платёж; ${regularFirst.length ? 'затем досрочные regularFirst' : 'досрочных в дату платежа нет'}` : 'Регулярный платёж')
    })
    previousPaymentDate = paymentDate
    paymentDate = nextPaymentDate(paymentDate, config)
  }
  return schedule
}
