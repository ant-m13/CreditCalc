import type { EarlyRepayment, GracePeriod, LoanConfig } from './types'
import { generateBaseSchedule } from './generateBaseSchedule'

export const applyEarlyRepayment = (config: LoanConfig, repayments: EarlyRepayment[], gracePeriods: GracePeriod[] = []) =>
  generateBaseSchedule(config, { earlyRepayments: repayments, gracePeriods })
