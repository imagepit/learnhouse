'use client'

import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { getFileTreeIconMeta, getLanguageMeta } from './language-icon'
import { mapCodeLineText } from './code-line-contract'
import { jsx, jsxs } from 'react/jsx-runtime'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import type { Root } from 'hast'
import { parseAnnotations } from './annotations'

export type FileTreeEntryKind = 'directory' | 'file' | 'placeholder'
export type FileTreeEntryStatus = 'added' | 'modified' | 'removed'
export interface FileTreeCommentPart {
  text: string
  emphasized?: boolean
}
export interface FileTreeEntry {
  name: string
  kind: FileTreeEntryKind
  children?: readonly FileTreeEntry[]
  comment?: readonly FileTreeCommentPart[]
  callout?: { label: string }
  status?: FileTreeEntryStatus
  emphasized?: boolean
  highlighted?: boolean
}

function FileTreeRow({ entry, icon }: { entry: FileTreeEntry; icon: "simple" | "colored" }) {
  const { Icon, extension } = getFileTreeIconMeta(entry.name, entry.kind);
  const statusLabel = entry.status === "added"
    ? "追加"
    : entry.status === "modified"
      ? "更新"
      : entry.status === "removed"
        ? "削除"
        : undefined;
  const statusSymbol = entry.status === "added" ? "+" : entry.status === "modified" ? "~" : "−";

  return (
    <>
      <span className="ui-file-tree__label">
        {entry.status ? (
          <span aria-hidden="true" className="ui-file-tree__status-symbol">
            {statusSymbol}
          </span>
        ) : null}
        {statusLabel ? <span className="ui-file-tree__sr-only">{statusLabel}: </span> : null}
        <Icon
          aria-hidden="true"
          className="ui-file-tree__icon"
          data-extension={extension}
          data-kind={entry.kind}
          data-mode={icon}
        />
        <span className={entry.emphasized ? "ui-file-tree__name ui-file-tree__name--emphasized" : "ui-file-tree__name"}>
          {entry.name}
        </span>
        {entry.comment ? (
          <span className="ui-file-tree__comment">
            # {entry.comment.map((part, index) => (
              part.emphasized
                ? <strong key={`${part.text}-${index}`}>{part.text}</strong>
                : part.text
            ))}
          </span>
        ) : null}
        {entry.callout ? (
          <span className="line-callout">
            <span className="line-callout__arrow" aria-hidden="true">{"<--"}</span>
            <span className="line-callout__label">
              {mapCodeLineText<ReactNode>(
                entry.callout.label,
                (segment) => segment,
                (index) => <br key={`file-tree-callout-break-${index}`} />,
              )}
            </span>
          </span>
        ) : null}
      </span>
    </>
  );
}

function FileTreeEntries({ entries, depth = 0 }: { entries: readonly FileTreeEntry[]; depth?: number }) {
  return <ul data-slot="file-tree-list">
    {entries.map((entry, index) => {
      const indent: CSSProperties & { '--ip-file-tree-indent': string } = { '--ip-file-tree-indent': `calc(${depth} * var(--ip-space-5))` }
      const row = <FileTreeRow entry={entry} icon="colored" />
      return <li key={index} data-slot="file-tree-item" data-kind={entry.kind} data-status={entry.status} data-highlighted={entry.highlighted || undefined}>
        {entry.kind === 'directory' && entry.children?.length ? (
          <details open>
            <summary className="ui-file-tree__row" data-slot="file-tree-row" style={indent}>{row}</summary>
            <FileTreeEntries entries={entry.children} depth={depth + 1} />
          </details>
        ) : <div className="ui-file-tree__row" data-slot="file-tree-row" style={indent}>{row}</div>}
      </li>
    })}
  </ul>
}

export function FileTree({ title, entries }: { title?: string; entries: readonly FileTreeEntry[] }) {
  return <section aria-label={title || 'ファイルツリー'} className="ui-file-tree" data-slot="file-tree">
    {title && <div className="ui-file-tree__title" data-slot="file-tree-title">{title}</div>}
    <FileTreeEntries entries={entries} />
  </section>
}

export function AnnotatedCode({ source, language, copy }: { source: string; language: string; copy: boolean }) {
  const [result, setResult] = useState<{ source: string; language: string; tree: Root }>()
  const parsed = parseAnnotations(source, { callouts: true, turnCallouts: true })

  useEffect(() => {
    let current = true
    import('./highlight').then(({ highlightAnnotated }) =>
      highlightAnnotated(source, language, { callouts: true, turnCallouts: true }),
    ).then(({ tree }) => {
      if (current) setResult({ source, language, tree })
    }).catch(() => {
      // The source remains readable if a language grammar cannot load.
    })
    return () => { current = false }
  }, [source, language])

  const { Icon, label } = getLanguageMeta(language || 'text')
  return <figure className="ui-code-block" data-slot="code-block">
    <figcaption className="ui-code-block__header">
      <span className="ui-code-block__filename"><Icon className="ui-code-block__lang-icon" aria-hidden="true" />{label}</span>
      {copy && <button className="copy-button" aria-label="コードをコピー" type="button" onClick={() => { void navigator.clipboard.writeText(parsed.code).catch(() => {}) }}>
        <Copy size={15} aria-hidden="true" />コピー
      </button>}
    </figcaption>
    {result?.source === source && result.language === language
      ? <div className="ui-code-block__pre ui-code-lines">{toJsxRuntime(result.tree, { Fragment, jsx, jsxs })}</div>
      : <pre className="ui-code-block__pre"><code>{parsed.code}</code></pre>}
  </figure>
}
