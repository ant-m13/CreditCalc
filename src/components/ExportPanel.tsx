import { useRef, useState } from 'react'
import { ArrowDownToLine, Check, CircleHelp, FileJson, Landmark, Link2, Printer, ReceiptText, Upload, X } from 'lucide-react'
import { parseLoanBackup, type LoanBackupData } from '../importExport'
import type { LoanProfile } from '../store'
import { money, shortDate, fmtMonthsFull } from '../formatters'
import { scenarioName } from '../labels'
import { Field } from './ui'

const MAX_JSON_IMPORT_SIZE = 2 * 1024 * 1024

function JsonImportModal({ fileName, data, createNew, replaceCurrent, decline }: { fileName: string; data: LoanBackupData; createNew: () => void; replaceCurrent: () => void; decline: () => void }) {
  return <div className="modal-backdrop"><div className="modal shared-modal"><div className="modal-head"><div><span className="eyebrow">JSON-файл</span><h2>Загрузить кредит из файла?</h2></div><button className="icon-btn" aria-label="Закрыть окно импорта JSON" onClick={decline}><X/></button></div><div className="modal-body"><p className="share-warning">Файл «{fileName}» прочитан. Проверьте краткое содержимое и выберите, как загрузить кредит.</p><dl className="share-summary">{data.name && <div><dt>Название</dt><dd>{data.name}</dd></div>}<div><dt>Сумма кредита</dt><dd>{money(data.config.principal)}</dd></div><div><dt>Ставка</dt><dd>{data.config.annualRate}%</dd></div><div><dt>Дата выдачи</dt><dd>{shortDate(data.config.issueDate)}</dd></div><div><dt>Первый платёж</dt><dd>{shortDate(data.config.firstPaymentDate)}</dd></div><div><dt>Срок</dt><dd>{fmtMonthsFull(data.config.termMonths)}</dd></div><div><dt>Досрочные платежи</dt><dd>{data.repayments.length}</dd></div><div><dt>Правила</dt><dd>{data.repaymentRules.length}</dd></div><div><dt>Льготные периоды</dt><dd>{data.gracePeriods.length}</dd></div><div><dt>Сценарий</dt><dd>{scenarioName(data.selectedScenario)}</dd></div></dl></div><div className="modal-actions"><button className="ghost" onClick={decline}>Отмена</button><button className="ghost" onClick={replaceCurrent}>Заменить текущий</button><button className="primary" onClick={createNew}>Создать новый кредит</button></div></div></div>
}

export function ExportPanel({ loans, exportLoanId, setExportLoanId, download, createFromJson, replaceFromJson, copyShareLink, status }: { loans: LoanProfile[]; exportLoanId: string; setExportLoanId: (id: string) => void; download: (x: 'csv'|'json'|'xls', loanId?: string) => void; createFromJson: (data: LoanBackupData, fileName: string) => void; replaceFromJson: (data: LoanBackupData, fileName: string) => void; copyShareLink: () => void; status: { kind: 'success' | 'error'; text: string } | null }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ fileName: string; data: LoanBackupData } | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const readJson = async (file: File) => {
    setLocalError(null)
    try {
      if (file.size > MAX_JSON_IMPORT_SIZE) throw new Error('JSON-файл слишком большой. Максимальный размер — 2 МБ')
      setPending({ fileName: file.name, data: parseLoanBackup(await file.text()) })
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось загрузить файл')
    }
  }
  return <section className="panel export-panel"><div className="panel-head"><div><h3>Импорт/экспорт расчёта</h3><p>Выберите кредит и действие</p></div></div><div className="export-target"><Field label="Какой кредит выгружать"><select value={exportLoanId} onChange={event => setExportLoanId(event.target.value)}>{loans.map(loan => <option key={loan.id} value={loan.id}>{loan.name}</option>)}</select></Field></div><div className="export-grid compact-export-grid"><button onClick={() => download('csv', exportLoanId)}><span className="export-icon green"><ReceiptText/></span><b>CSV</b><ArrowDownToLine/></button><button onClick={() => download('xls', exportLoanId)}><span className="export-icon emerald"><Landmark/></span><b>Excel</b><ArrowDownToLine/></button><button onClick={() => download('json', exportLoanId)}><span className="export-icon violet"><FileJson/></span><b>Сохранить JSON</b><ArrowDownToLine/></button><button onClick={() => inputRef.current?.click()}><span className="export-icon import"><Upload/></span><b>Загрузить JSON</b><Upload/></button><button onClick={copyShareLink}><span className="export-icon link"><Link2/></span><b>Ссылка на расчёт</b><Link2/></button><button onClick={() => window.print()}><span className="export-icon amber"><Printer/></span><b>PDF / печать</b><ArrowDownToLine/></button></div><input ref={inputRef} className="file-input" type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) void readJson(file); event.currentTarget.value = '' }}/>{(status || localError) && <div className={`import-status ${localError ? 'error' : status!.kind}`} role="status" aria-live="polite">{!localError && status?.kind === 'success' ? <Check/> : <CircleHelp/>}{localError ?? status?.text}</div>}{pending && <JsonImportModal fileName={pending.fileName} data={pending.data} decline={() => setPending(null)} createNew={() => { createFromJson(pending.data, pending.fileName); setPending(null) }} replaceCurrent={() => { replaceFromJson(pending.data, pending.fileName); setPending(null) }}/>}</section>
}
