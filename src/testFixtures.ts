import type { LoanConfig } from './loanEngine'
import { defaultConfig } from './loanDefaults'

// Короткий срок ускоряет UI-тесты, в которых длина кредитного графика не является предметом проверки.
export const shortTestConfig: LoanConfig = {
  ...defaultConfig,
  termMonths: 12
}
