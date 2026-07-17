import { APP_VERSION, BUILD_DATE, CHANGELOG, COMMIT_SHA, formatBuildDate, shortCommitSha } from '../version'

export function Changelog() {
  return <section className="panel changelog-panel"><div className="panel-head"><div><h3>Что изменилось</h3><p>Версия приложения: {APP_VERSION}. Ревизия: {shortCommitSha(COMMIT_SHA)}. Сборка: {formatBuildDate(BUILD_DATE)}.</p></div></div><div className="changelog-list">{CHANGELOG.map(entry => <article key={entry.version} className="changelog-entry"><div><span className="eyebrow">v{entry.version} · {entry.date}</span><h4>{entry.title}</h4><ul>{entry.items.map(item => <li key={item}>{item}</li>)}</ul></div></article>)}</div></section>
}
