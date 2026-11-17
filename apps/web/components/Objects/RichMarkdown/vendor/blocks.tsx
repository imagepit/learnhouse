'use client'

import { Fragment, useEffect, useState } from 'react'
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

function FileTreeEntries({ entries }: { entries: readonly FileTreeEntry[] }) {
  return <ul>{entries.map((entry, index) => (
    <li key={index} data-status={entry.status} data-highlighted={entry.highlighted || undefined}>
      {entry.emphasized ? <strong>{entry.name}</strong> : entry.name}
      {entry.kind === 'directory' && '/'}
      {entry.comment?.map((part, i) =>
        part.emphasized ? <strong key={i}>{part.text}</strong> : <span key={i}>{part.text}</span>
      )}
      {entry.callout && <span className="lh-rich-note">{entry.callout.label}</span>}
      {entry.children && <FileTreeEntries entries={entry.children} />}
    </li>
  ))}</ul>
}

export function FileTree({ title, entries }: { title?: string; entries: readonly FileTreeEntry[] }) {
  return <figure className="lh-rich-file-tree">
    {title && <figcaption>{title}</figcaption>}
    <FileTreeEntries entries={entries} />
  </figure>
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

  return <figure className="lh-rich-code">
    {copy && <button type="button" onClick={() => { void navigator.clipboard.writeText(parsed.code).catch(() => {}) }}>Copy code</button>}
    {result?.source === source && result.language === language
      ? toJsxRuntime(result.tree, { Fragment, jsx, jsxs })
      : <pre><code>{parsed.code}</code></pre>}
  </figure>
}
