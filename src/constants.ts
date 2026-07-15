// Общие коэффициенты хранятся здесь, чтобы финансовые и календарные формулы не зависели от неименованных чисел.
export const PERCENT_FACTOR = 100
export const CENTS_PER_CURRENCY_UNIT = 100

export const MONTHS_PER_YEAR = 12
export const MONTHS_PER_BIMONTH = 2
export const MONTHS_PER_QUARTER = 3
export const MONTHS_PER_HALF_YEAR = 6
export const DAYS_PER_BIWEEK = 14
export const BIWEEKLY_PERIODS_PER_YEAR = 26
export const QUARTERLY_PERIODS_PER_YEAR = 4
export const DAYS_IN_BANK_YEAR = 360
export const DAYS_IN_COMMON_YEAR = 365
export const DAYS_IN_LEAP_YEAR = 366
export const MILLISECONDS_PER_DAY = 86_400_000

export const ISO_DATE_LENGTH = 10
export const ISO_YEAR_LENGTH = 4
export const ISO_YEAR_MONTH_LENGTH = 7
export const CURRENCY_DECIMAL_PLACES = 2
export const JSON_INDENT_SPACES = 2

// Порог ниже половины копейки скрывает шум вычислений, но не скрывает сумму в одну копейку.
export const MONEY_DISPLAY_EPSILON = 0.004
