import { useRef, useState } from 'react'
import { ArrowDownToLine, Check, CircleHelp, Clipboard, ClipboardPaste, FileJson, KeyRound, Landmark, Link2, Printer, ReceiptText, Upload, X } from 'lucide-react'
import { parseLoanBackup, type LoanBackupData } from '../importExport'
import { formatMoney, shortDate, fmtMonthsFull } from '../formatters'
import { useModalDialog } from '../hooks/useModalDialog'
import { rateChangeModeName, scenarioName } from '../labels'
import { Field } from './ui'

const MAX_JSON_IMPORT_SIZE = 2 * 1024 * 1024

type Status = { kind: 'success' | 'error'; text: string }

interface ImportPreview {
  title: string
  description: string
  sourceLabel: string
  actionSource: string
  data: LoanBackupData
}

function ImportPreviewModal({ pending, createNew, replaceCurrent, decline }: { pending: ImportPreview; createNew: () => void; replaceCurrent: () => void; decline: () => void }) {
  const { dialogRef, titleId } = useModalDialog(decline)
  const { data } = pending
  const previewMoney = (value: number) => formatMoney(value, data.config.currency, data.displayDecimals)
  return <div className="modal-backdrop"><div className="modal shared-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-head"><div><span className="eyebrow">{pending.sourceLabel}</span><h2 id={titleId}>{pending.title}</h2></div><button className="icon-btn" aria-label="Закрыть окно импорта" onClick={decline}><X/></button></div><div className="modal-body"><p className="share-warning">{pending.description}</p>{data.importWarnings?.map(warning => <p className="share-warning" role="status" key={warning}>{warning}</p>)}<dl className="share-summary">{data.name && <div><dt>Название</dt><dd>{data.name}</dd></div>}<div><dt>Сумма кредита</dt><dd>{previewMoney(data.config.principal)}</dd></div><div><dt>Ставка</dt><dd>{data.config.annualRate}%{data.config.rateChanges.length ? ` · изменений: ${data.config.rateChanges.length}` : ''}</dd></div>{data.config.rateChanges.length > 0 && <div><dt>Режим ставки</dt><dd>{rateChangeModeName(data.config.rateChangeMode)}</dd></div>}<div><dt>Дата выдачи</dt><dd>{shortDate(data.config.issueDate)}</dd></div><div><dt>Первый платёж</dt><dd>{shortDate(data.config.firstPaymentDate)}</dd></div><div><dt>Срок</dt><dd>{fmtMonthsFull(data.config.termMonths)}</dd></div><div><dt>Досрочные платежи</dt><dd>{data.repayments.length}</dd></div><div><dt>Правила</dt><dd>{data.repaymentRules.length}</dd></div><div><dt>Льготные периоды</dt><dd>{data.gracePeriods.length}</dd></div><div><dt>Сценарий</dt><dd>{scenarioName(data.selectedScenario)}</dd></div></dl></div><div className="modal-actions"><button className="ghost" onClick={decline}>Отмена</button><button className="ghost" onClick={replaceCurrent}>Заменить текущий</button><button className="primary" onClick={createNew}>Создать новый кредит</button></div></div></div>
}

function ParameterCodeModal({ code, close, copy }: { code: string; close: () => void; copy: () => void }) {
  const { dialogRef, titleId } = useModalDialog(close)
  return <div className="modal-backdrop"><div className="modal shared-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-head"><div><span className="eyebrow">Код параметров</span><h2 id={titleId}>Перенос расчёта</h2></div><button className="icon-btn" aria-label="Закрыть окно кода параметров" onClick={close}><X/></button></div><div className="modal-body"><Field label="Строка параметров"><textarea className="parameter-code-area" readOnly value={code} onFocus={event => event.currentTarget.select()}/></Field><p className="share-warning">Эту строку можно вставить в другом приложении через “Загрузить код”.</p></div><div className="modal-actions"><button className="ghost" onClick={close}>Закрыть</button><button className="primary" onClick={copy}><Clipboard/> Скопировать</button></div></div></div>
}

function ParameterImportModal({ value, setValue, paste, submit, close, linkDetected, confirmLink, cancelLink }: { value: string; setValue: (value: string) => void; paste: () => void; submit: () => void; close: () => void; linkDetected: boolean; confirmLink: () => void; cancelLink: () => void }) {
  const { dialogRef, titleId } = useModalDialog(close)
  return <div className="modal-backdrop"><div className="modal shared-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-head"><div><span className="eyebrow">Код параметров</span><h2 id={titleId}>Загрузить расчёт</h2></div><button className="icon-btn" aria-label="Закрыть окно загрузки кода" onClick={close}><X/></button></div><div className="modal-body"><Field label="Строка параметров"><textarea className="parameter-code-area" autoFocus value={value} onChange={event => setValue(event.target.value)} placeholder="v1.H4sIA..."/></Field>{linkDetected ? <div className="parameter-link-confirm"><b>Похоже, это полная ссылка на расчёт</b><span>Можно взять из неё код параметров и продолжить загрузку.</span><div><button className="ghost compact" onClick={cancelLink}>Оставить как есть</button><button className="primary compact" onClick={confirmLink}>Взять параметры</button></div></div> : <p className="share-warning">Введите код параметров. Если вставите полную ссылку на расчёт, приложение предложит взять параметры из неё.</p>}</div><div className="modal-actions"><button className="ghost" onClick={close}>Отмена</button><button className="ghost" onClick={paste}><ClipboardPaste/> Из буфера</button><button className="primary" onClick={submit}>Прочитать</button></div></div></div>
}

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    if (!copied) throw new Error('Не удалось скопировать текст')
  }
}

export function ExportPanel({
  download,
  print,
  calculatedExportsDisabled = false,
  createImported,
  replaceImported,
  copyShareLink,
  createParameterCode,
  decodeParameterCode,
  looksLikeParameterLink,
  status
}: {
  download: (x: 'csv'|'json'|'xls') => void
  print: () => void
  calculatedExportsDisabled?: boolean
  createImported: (data: LoanBackupData, source: string) => boolean
  replaceImported: (data: LoanBackupData, source: string) => boolean
  copyShareLink: () => void
  createParameterCode: () => Promise<string>
  decodeParameterCode: (code: string) => Promise<LoanBackupData>
  looksLikeParameterLink: (value: string) => boolean
  status: Status | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<ImportPreview | null>(null)
  const [localStatus, setLocalStatus] = useState<Status | null>(null)
  const [parameterCode, setParameterCode] = useState<string | null>(null)
  const [codeInputOpen, setCodeInputOpen] = useState(false)
  const [codeDraft, setCodeDraft] = useState('')
  const [confirmLink, setConfirmLink] = useState(false)

  const visibleStatus = localStatus ?? status
  const calculatedExportTitle = calculatedExportsDisabled ? 'Дождитесь завершения пересчёта графика' : undefined

  const readJson = async (file: File) => {
    setLocalStatus(null)
    try {
      if (file.size > MAX_JSON_IMPORT_SIZE) throw new Error('JSON-файл слишком большой. Максимальный размер — 2 МБ')
      setPending({
        title: 'Загрузить кредит из файла?',
        description: `Файл «${file.name}» прочитан. Проверьте краткое содержимое и выберите, как загрузить кредит.`,
        sourceLabel: 'JSON-файл',
        actionSource: `файла «${file.name}»`,
        data: parseLoanBackup(await file.text())
      })
    } catch (error) {
      setLocalStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось загрузить файл' })
    }
  }

  const showParameterCode = async () => {
    setLocalStatus(null)
    try {
      setParameterCode(await createParameterCode())
    } catch (error) {
      setLocalStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось сформировать код параметров' })
    }
  }

  const copyParameterCode = async () => {
    if (!parameterCode) return
    try {
      await copyText(parameterCode)
      setLocalStatus({ kind: 'success', text: 'Код параметров скопирован' })
    } catch (error) {
      setLocalStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось скопировать код параметров' })
    }
  }

  const pasteParameterCode = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      setCodeDraft(text)
      setConfirmLink(looksLikeParameterLink(text))
      setLocalStatus({ kind: 'success', text: 'Код параметров вставлен из буфера' })
    } catch {
      setLocalStatus({ kind: 'error', text: 'Браузер не дал прочитать буфер обмена' })
    }
  }

  const submitParameterCode = async (allowLink = false) => {
    setLocalStatus(null)
    try {
      const code = codeDraft.trim()
      if (!code) throw new Error('Введите код параметров')
      if (!allowLink && looksLikeParameterLink(code)) {
        setConfirmLink(true)
        return
      }
      setPending({
        title: 'Загрузить кредит из кода?',
        description: 'Код параметров прочитан. Проверьте краткое содержимое и выберите, как загрузить кредит.',
        sourceLabel: 'Код параметров',
        actionSource: 'кода параметров',
        data: await decodeParameterCode(code)
      })
      setCodeInputOpen(false)
      setCodeDraft('')
      setConfirmLink(false)
    } catch (error) {
      setLocalStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось прочитать код параметров' })
    }
  }

  return <section className="panel export-panel"><div className="panel-head"><div><h3>Импорт/экспорт расчёта</h3><p>Действия выполняются для кредита, выбранного в шапке</p></div></div><div className="export-grid compact-export-grid"><button onClick={() => download('csv')} disabled={calculatedExportsDisabled} title={calculatedExportTitle}><span className="export-icon green"><ReceiptText/></span><b>CSV</b><ArrowDownToLine/></button><button onClick={() => download('xls')} disabled={calculatedExportsDisabled} title={calculatedExportTitle}><span className="export-icon emerald"><Landmark/></span><b>Excel</b><ArrowDownToLine/></button><button onClick={() => download('json')}><span className="export-icon violet"><FileJson/></span><b>Сохранить JSON</b><ArrowDownToLine/></button><button onClick={() => inputRef.current?.click()}><span className="export-icon import"><Upload/></span><b>Загрузить JSON</b><Upload/></button><button onClick={copyShareLink}><span className="export-icon link"><Link2/></span><b>Ссылка на расчёт</b><Link2/></button><button onClick={showParameterCode}><span className="export-icon link"><KeyRound/></span><b>Код параметров</b><Clipboard/></button><button onClick={() => { setCodeDraft(''); setConfirmLink(false); setCodeInputOpen(true); setLocalStatus(null) }}><span className="export-icon import"><ClipboardPaste/></span><b>Загрузить код</b><Upload/></button><button onClick={print} disabled={calculatedExportsDisabled} title={calculatedExportTitle}><span className="export-icon amber"><Printer/></span><b>PDF / печать</b><ArrowDownToLine/></button></div><input ref={inputRef} className="file-input" type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) void readJson(file); event.currentTarget.value = '' }}/>{visibleStatus && <div className={`import-status ${visibleStatus.kind}`} role="status" aria-live="polite">{visibleStatus.kind === 'success' ? <Check/> : <CircleHelp/>}{visibleStatus.text}</div>}{pending && <ImportPreviewModal pending={pending} decline={() => setPending(null)} createNew={() => { if (createImported(pending.data, pending.actionSource)) setPending(null) }} replaceCurrent={() => { if (replaceImported(pending.data, pending.actionSource)) setPending(null) }}/>} {parameterCode && <ParameterCodeModal code={parameterCode} close={() => setParameterCode(null)} copy={() => void copyParameterCode()}/>} {codeInputOpen && <ParameterImportModal value={codeDraft} setValue={value => { setCodeDraft(value); setConfirmLink(looksLikeParameterLink(value)) }} paste={() => void pasteParameterCode()} submit={() => void submitParameterCode()} close={() => { setCodeInputOpen(false); setConfirmLink(false) }} linkDetected={confirmLink} confirmLink={() => void submitParameterCode(true)} cancelLink={() => setConfirmLink(false)}/>}</section>
}
