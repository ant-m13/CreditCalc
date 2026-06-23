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

export function generateBaseSchedule(config: LoanConfig, options: Options = {}): PaymentScheduleItem[] {
  const repayments = [...(options.earlyRepayments ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const gracePeriods = options.gracePeriods ?? []
  const maxPeriods = totalPeriods(config) + gracePeriods.filter(g => g.extendTerm).reduce((sum, g) => sum + Math.max(1, Math.ceil((+parseISO(g.endDate) - +parseISO(g.startDate)) / 2629800000)), 0)
  let balance = money(config.principal, config.rounding)
  let payment = config.paymentType === 'annuity' ? calculateAnnuityPayment(balance, config.annualRate, totalPeriods(config), periodsPerYear(config.frequency), config.rounding) : money(new Decimal(balance).div(totalPeriods(config)), config.rounding)
  let paymentDate = config.firstPaymentDate
  let previousDate = config.issueDate
  let cumulativeInterest = new Decimal(0)
  let deferredInterest = new Decimal(0)
  let repaymentIndex = 0
  const schedule: PaymentScheduleItem[] = []

  for (let n = 1; n <= Math.max(maxPeriods + 240, 360) && balance.gt(0); n++) {
    const opening = balance
    const days = periodDays(previousDate, paymentDate, config.interest.includePaymentDate)
    const periodCalendarDays = Math.max(1, periodDays(previousDate, paymentDate, false))
    const grace = activeGrace(paymentDate, gracePeriods)
    let chargedInterest = new Decimal(0)
    let interestDue = deferredInterest
    deferredInterest = new Decimal(0)
    let principalPart = new Decimal(0)
    let regularPayment = new Decimal(0)
    let earlyTotal = new Decimal(0)
    let earlyFees = new Decimal(0)
    let event = ''
    let comment = ''
    let segmentStart = previousDate
    const beforePayment: EarlyRepayment[] = []
    const onPaymentDate: EarlyRepayment[] = []

    while (repaymentIndex < repayments.length && repayments[repaymentIndex].date <= paymentDate) {
      const early = repayments[repaymentIndex++]
      if (early.date < previousDate) continue
      if (early.date === paymentDate) onPaymentDate.push(early)
      else beforePayment.push(early)
    }

    const accrue = (from: string, to: string, includeTo: boolean, currentBalance: Decimal) => {
      if (to < from || currentBalance.lte(0)) return new Decimal(0)
      if (config.interest.method === 'daily') {
        return money(calculateInterest(currentBalance, config.annualRate, from, to, { ...config.interest, includePaymentDate: includeTo }), config.rounding)
      }
      const segmentDays = periodDays(from, to, includeTo)
      return money(currentBalance.mul(config.annualRate).div(100).div(periodsPerYear(config.frequency)).mul(segmentDays).div(periodCalendarDays), config.rounding)
    }

    const applyEarly = (early: EarlyRepayment) => {
      const strategy = options.forcedStrategy ?? early.strategy
      const fee = money(new Decimal(early.amount).mul(config.earlyRepaymentFeePercent).div(100), config.rounding)
      let available = Decimal.max(0, new Decimal(early.amount).minus(fee))
      const paidInterest = early.interestFirst ? Decimal.min(interestDue, available) : new Decimal(0)
      interestDue = interestDue.minus(paidInterest)
      available = available.minus(paidInterest)
      const paidPrincipal = Decimal.min(balance, available)
      balance = Decimal.max(0, balance.minus(paidPrincipal))
      earlyTotal = earlyTotal.add(paidInterest).add(paidPrincipal)
      earlyFees = earlyFees.add(fee)
      const fullyClosed = balance.isZero() && interestDue.lte(0)
      event = strategy === 'reduceTerm' ? 'Пересчёт · сокращение срока' : strategy === 'reducePayment' ? 'Пересчёт · уменьшение платежа' : strategy === 'full' ? (fullyClosed ? 'Полное досрочное погашение' : 'Полное погашение · недостаточно средств') : 'Комбинированный пересчёт'
      comment = [comment, early.comment].filter(Boolean).join('; ')
      if (strategy === 'reducePayment' && balance.gt(0)) {
        const remaining = Math.max(1, maxPeriods - n + 1)
        payment = calculateAnnuityPayment(balance, config.annualRate, remaining, periodsPerYear(config.frequency), config.rounding)
      }
    }

    for (const early of beforePayment) {
      const includeEventDay = config.interest.includePaymentDate && config.interest.balanceMoment === 'startOfDay'
      const segmentInterest = accrue(segmentStart, early.date, includeEventDay, balance)
      chargedInterest = chargedInterest.add(segmentInterest)
      interestDue = interestDue.add(segmentInterest)
      applyEarly(early)
      segmentStart = includeEventDay ? iso(addDays(parseISO(early.date), 1)) : early.date
    }

    const earlyFirst = onPaymentDate.filter(r => r.sameDayOrder === 'earlyFirst')
    const regularFirst = onPaymentDate.filter(r => r.sameDayOrder === 'regularFirst')
    const includeFinalDayBeforePayment = config.interest.includePaymentDate && config.interest.balanceMoment === 'startOfDay'
    const finalInterest = accrue(segmentStart, paymentDate, includeFinalDayBeforePayment, balance)
    chargedInterest = chargedInterest.add(finalInterest)
    interestDue = interestDue.add(finalInterest)
    earlyFirst.forEach(applyEarly)

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
      if (grace?.type === 'interestOnly') {
        targetPayment = interestDue
        event = event || 'Льготный период · только проценты'
      } else if (grace?.type === 'reduced' || grace?.type === 'custom') {
        targetPayment = money(grace.paymentAmount ?? payment.div(2), config.rounding)
        event = event || 'Льготный период · особый платёж'
      } else if (config.paymentType === 'differentiated') {
        targetPayment = money(interestDue.add(new Decimal(config.principal).div(totalPeriods(config))), config.rounding)
      }
      const paidInterest = Decimal.min(interestDue, targetPayment)
      const availableForPrincipal = Decimal.max(0, targetPayment.minus(paidInterest))
      principalPart = Decimal.min(balance, availableForPrincipal)
      balance = Decimal.max(0, balance.minus(principalPart))
      interestDue = interestDue.minus(paidInterest)
      regularPayment = money(paidInterest.add(principalPart), config.rounding)
      if (interestDue.gt(0)) deferredInterest = deferredInterest.add(interestDue)
    }

    regularFirst.forEach(applyEarly)

    if (config.interest.includePaymentDate && config.interest.balanceMoment === 'endOfDay' && balance.gt(0)) {
      const endDayInterest = accrue(paymentDate, iso(addDays(parseISO(paymentDate), 1)), false, balance)
      chargedInterest = chargedInterest.add(endDayInterest)
      deferredInterest = deferredInterest.add(endDayInterest)
    }

    if (balance.gt(0) && balance.lte(config.closeThreshold)) {
      principalPart = principalPart.add(balance)
      regularPayment = regularPayment.add(balance)
      balance = new Decimal(0)
      event = event || 'Автозакрытие малого остатка'
    }
    cumulativeInterest = cumulativeInterest.add(chargedInterest)
    schedule.push({
      number: n, date: paymentDate, days, openingBalance: num(opening, config.rounding), payment: num(regularPayment, config.rounding),
      interest: num(chargedInterest, config.rounding), principal: num(principalPart, config.rounding), earlyPayment: num(earlyTotal, config.rounding),
      closingBalance: num(balance, config.rounding), cumulativeInterest: num(cumulativeInterest, config.rounding), cumulativeSavings: 0,
      fee: num(earlyFees.add(config.monthlyFee).add(n === 1 ? config.oneTimeFee : 0), config.rounding), comment, event
    })
    previousDate = paymentDate
    paymentDate = nextPaymentDate(paymentDate, config)
  }
  return schedule
}
