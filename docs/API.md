# API для внешних интеграций

Приложение не предоставляет сетевой backend API. Под интеграционным API здесь понимаются стабильные форматы обмена данными:

- JSON-экспорт расчёта;
- share-link с параметрами расчёта в URL;
- правила версионирования этих форматов.

Оба формата сохраняют только исходные параметры кредита и пользовательские настройки. Готовый график платежей, итоги сценариев и промежуточные расчётные поля не экспортируются: принимающая сторона должна пересчитать их локально.

## JSON-экспорт

JSON-файл создаётся кнопкой экспорта в приложении. Текущий формат основан на снимке `SharedCalculationV1` и дополнительно содержит `exportedAt`. Перед созданием JSON приложение проверяет обязательные поля кредита и расчётные ограничения, чтобы не распространять заведомо невалидный payload.

Минимальная структура:

```json
{
  "version": 1,
  "name": "Мой кредит",
  "config": {
    "principal": 7200000,
    "annualRate": 12.4,
    "rateChanges": [],
    "rateChangeMode": "nextPeriod",
    "issueDate": "2026-06-23",
    "firstPaymentDate": "2026-07-15",
    "firstPaymentInterestOnly": true,
    "termMonths": 240,
    "paymentDay": 15,
    "paymentType": "annuity",
    "frequency": "monthly",
    "currency": "RUB",
    "rounding": "kopecks",
    "closeThreshold": 300,
    "oneTimeFee": 0,
    "monthlyFee": 0,
    "earlyRepaymentFeePercent": 0,
    "interest": {
      "method": "daily",
      "dayCountBasis": "actualActual",
      "includePaymentDate": true,
      "periodStart": "exclusive",
      "balanceMoment": "startOfDay"
    }
  },
  "repayments": [],
  "repaymentRules": [],
  "gracePeriods": [],
  "selectedScenario": "combined",
  "settings": {
    "termUnit": "months",
    "displayDecimals": 2,
    "appFontSize": "normal",
    "scheduleFontSize": "large",
    "theme": "emerald",
    "customAccentColor": "#0b9873",
    "useCustomAccentColor": false
  },
  "exportedAt": "2026-07-07T10:00:00.000Z"
}
```

### Верхний уровень

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `version` | `1` | рекомендуется | Версия формата снимка. Для старых JSON может отсутствовать. |
| `name` | `string` | нет | Название кредита. Ограничение: 500 символов. |
| `config` | `LoanConfig` | да | Основные параметры кредита. |
| `repayments` | `EarlyRepayment[]` | нет | Разовые досрочные платежи. Если отсутствует, считается пустым массивом. |
| `repaymentRules` | `RepaymentRule[]` | нет | Регулярные правила досрочного погашения. Если отсутствует, считается пустым массивом. |
| `gracePeriods` | `GracePeriod[]` | нет | Льготные периоды. Если отсутствует, считается пустым массивом. |
| `selectedScenario` | `string` | нет | Выбранный сценарий. По умолчанию `reduceTerm`. |
| `settings` | `object` | нет | Настройки отображения. Для старых JSON допускаются эти поля прямо на верхнем уровне. |
| `exportedAt` | ISO datetime | нет | Время создания файла. При импорте используется только как справочное поле. |

### `config`

| Поле | Тип / значения |
| --- | --- |
| `principal` | number, больше 0 |
| `annualRate` | number, от 0 до 100 |
| `rateChanges` | `RateChange[]`, максимум 1000 |
| `rateChangeMode` | `nextPeriod` или `exactDate` |
| `issueDate` | дата `YYYY-MM-DD` |
| `firstPaymentDate` | дата `YYYY-MM-DD`, строго после `issueDate` |
| `firstPaymentInterestOnly` | boolean |
| `termMonths` | integer, от 1 до 1200 |
| `paymentDay` | integer, от 1 до 31 |
| `paymentType` | `annuity` или `differentiated` |
| `frequency` | `monthly`, `biweekly` или `quarterly` |
| `currency` | `RUB`, `USD`, `EUR` или `CNY`; неподдерживаемые legacy-значения при импорте нормализуются в `RUB` с предупреждением |
| `rounding` | `kopecks`, `rubles` или `bank` |
| `closeThreshold` | number, не меньше 0 |
| `oneTimeFee` | number, не меньше 0 |
| `monthlyFee` | number, не меньше 0 |
| `earlyRepaymentFeePercent` | number, от 0 до 100 |
| `interest` | `InterestConfig` |

`RateChange`:

```ts
{
  id: string
  date: string
  annualRate: number
}
```

`date` должна быть корректной датой `YYYY-MM-DD`, позже `config.issueDate`; даты изменений ставки не должны повторяться.

`InterestConfig`:

```ts
{
  method: 'annuity' | 'daily'
  dayCountBasis: '365' | '366' | '360' | 'actual365' | 'actualActual'
  includePaymentDate: boolean
  periodStart: 'inclusive' | 'exclusive'
  balanceMoment: 'startOfDay' | 'endOfDay'
}
```

### `repayments`

Разовый досрочный платёж:

```ts
{
  id: string
  date: string
  amount: number
  enabled?: boolean
  amountMode?: 'extra' | 'totalWithFee'
  sameDaySequence?: number
  operationSource?: 'manual' | 'rule'
  sourceRuleId?: string
  strategy: 'reduceTerm' | 'reducePayment' | 'full' | 'custom'
  source: 'own' | 'subsidy' | 'insurance' | 'other'
  sameDayOrder: 'regularFirst' | 'earlyFirst'
  interestFirst: boolean
  comment?: string
}
```

Ограничения:

- максимум 5000 элементов;
- `amount` может быть `0`, чтобы временно отключить платёж без удаления записи;
- `amountMode: 'totalWithFee'` допустим только в дату регулярного платежа и только после регулярного списания;
- для одной даты допускается только одна активная операция с `amountMode: 'totalWithFee'` и положительной суммой;
- `sameDaySequence`, если указан, должен быть целым числом не меньше 0 и не должен дублироваться в рамках одной даты.

### `repaymentRules`

Правило регулярного досрочного погашения:

```ts
{
  id: string
  name: string
  ruleSequence?: number
  type: 'weeklyFixed' | 'monthlyFixed' | 'bimonthlyFixed' | 'quarterlyFixed' | 'semiannualFixed' | 'annualFixed' | 'annualBonus' | 'paymentPercent' | 'monthlyTotalPayment'
  startDate: string
  endDate: string
  amount?: number
  percent?: number
  enabled?: boolean
  strategy: 'reduceTerm' | 'reducePayment' | 'full' | 'custom'
  source: 'own' | 'subsidy' | 'insurance' | 'other'
  sameDayOrder: 'regularFirst' | 'earlyFirst'
  interestFirst: boolean
  skipMonths: string[]
  comment?: string
}
```

Ограничения:

- максимум 5000 правил;
- `startDate` и `endDate` должны быть датами `YYYY-MM-DD`, `endDate` не раньше `startDate`;
- для `paymentPercent` требуется `percent`, для остальных типов требуется `amount`;
- `amount` и `percent` могут быть `0`, чтобы временно заморозить правило;
- `monthlyTotalPayment` всегда нормализуется к `sameDayOrder: 'regularFirst'`;
- `skipMonths` содержит строки `YYYY-MM`, максимум 1200 элементов.

### `gracePeriods`

Льготный период:

```ts
{
  id: string
  startDate: string
  endDate: string
  type: 'full' | 'interestOnly' | 'reduced' | 'custom'
  paymentAmount?: number
  extendTerm: boolean
  accrueInterest: boolean
  capitalizeInterest: boolean
}
```

Ограничения:

- максимум 100 элементов;
- `endDate` не раньше `startDate`;
- периоды не должны пересекаться;
- `paymentAmount`, если указан, должен быть неотрицательным.

### `settings`

```ts
{
  termUnit: 'months' | 'years'
  displayDecimals: 0 | 2
  appFontSize: 'normal' | 'large' | 'xlarge'
  scheduleFontSize: 'normal' | 'large' | 'xlarge'
  theme: 'emerald' | 'ocean' | 'violet' | 'graphite' | 'warm' | 'night'
  customAccentColor?: string
  useCustomAccentColor?: boolean
}
```

`customAccentColor` должен быть HEX-цветом вида `#0b9873`.

## Share-link

Share-link хранит тот же снимок расчёта, что и JSON, но без поля `exportedAt`. Перед созданием ссылки или короткого кода параметров применяется та же проверка, что и для JSON-экспорта.

Формат URL:

```text
https://example.com/CreditCalc/#calc=<payload>
```

Формат payload:

```text
v1.<base64url(gzip(utf8-json(SharedCalculationV1)))>
```

Расшифровка:

1. из URL hash берётся значение после `calc=`;
2. проверяется префикс `v1.`;
3. часть после префикса декодируется как Base64URL;
4. байты распаковываются через gzip;
5. результат читается как UTF-8 JSON;
6. JSON проходит ту же нормализацию и валидацию, что и импорт из файла.

Приложение также принимает:

- полный URL с `#calc=...`;
- строку `calc=...`;
- сырой payload `v1....`.
- payload `v1....`, внутри которого JSON может не содержать собственного поля `version`.

Ограничения share-link:

- максимальная длина закодированного payload: 120000 символов;
- максимальный размер JSON до или после распаковки: 600000 байт;
- если расчёт не помещается в эти лимиты, интеграция должна использовать JSON-файл.

## Версионирование и совместимость

Текущая версия снимка данных: `version: 1`.

Текущий префикс share-link: `v1.`.

Правила для интеграций:

- Генерируйте `version: 1` для новых JSON-файлов и share-link payload.
- При чтении JSON не полагайтесь на порядок полей.
- Игнорируйте неизвестные поля на верхнем уровне и внутри объектов, если они не конфликтуют с известной моделью.
- Передавайте даты только в формате `YYYY-MM-DD`, месяцы пропуска только в формате `YYYY-MM`.
- Не экспортируйте готовый график платежей как часть модели обмена: он является производным результатом.
- Для старых данных допускается отсутствие некоторых полей `config` и `config.interest`; приложение подставляет значения по умолчанию.
- Если поле `currency` отсутствует, используется `RUB`. Если legacy JSON или share-link содержит неподдерживаемое значение, приложение нормализует валюту в `RUB` и возвращает предупреждение импорта; суммы при этом не конвертируются. Новые интеграции должны создавать только `RUB`, `USD`, `EUR` или `CNY`.
- Share-link с неизвестным префиксом, например `v2.`, должен считаться неподдерживаемым.
- JSON или share-link с `version`, отличной от `1`, не следует создавать до появления отдельной миграции формата.

При добавлении новой версии формата нужно:

1. оставить чтение `version: 1`;
2. добавить явную миграцию из старой структуры в текущую модель;
3. сменить префикс share-link только при несовместимом изменении кодирования или структуры payload;
4. обновить этот документ вместе с кодом сериализации и импорта.
