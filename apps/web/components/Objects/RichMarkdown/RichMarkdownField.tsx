'use client'

import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import RichMarkdown, { MAX_MARKDOWN_LENGTH, textFormat, type TextFormat } from './RichMarkdown'

export default function RichMarkdownField({
  label, value, format, onChange, onFormatChange, className, placeholder, required, rows = 4,
}: {
  label: ReactNode
  value: string
  format: TextFormat
  onChange: (value: string) => void
  onFormatChange?: (format: TextFormat) => void
  className?: string
  placeholder?: string
  required?: boolean
  rows?: number
}) {
  const id = useId()
  const [preview, setPreview] = useState(false)
  const { i18n } = useTranslation()
  const ja = i18n.language?.startsWith('ja')
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm font-medium" htmlFor={id}>{label}</label>
      {onFormatChange && <select className="rounded-md border px-2 py-1 text-sm"
        aria-label={ja ? '本文の形式' : 'Text format'} value={format}
        onChange={event => onFormatChange(textFormat(event.target.value))}>
        <option value="plain">{ja ? 'プレーンテキスト' : 'Plain text'}</option>
        <option value="markdown">Markdown</option>
      </select>}
      {format === 'markdown' && <button type="button" className="rounded-md border px-2 py-1 text-sm"
        aria-pressed={preview} onClick={() => setPreview(value => !value)}>
        {ja ? 'プレビュー' : 'Preview'}
      </button>}
    </div>
    <textarea id={id} value={value} onChange={event => onChange(event.target.value)}
      maxLength={format === 'markdown' ? MAX_MARKDOWN_LENGTH : undefined}
      className={className ?? 'w-full rounded-md border p-2 text-sm'}
      placeholder={placeholder} required={required} rows={rows} />
    {format === 'markdown' && preview && <div className="rounded-md border p-3" aria-label={ja ? 'プレビュー' : 'Preview'}>
      <RichMarkdown source={value} format={format} />
    </div>}
  </div>
}
