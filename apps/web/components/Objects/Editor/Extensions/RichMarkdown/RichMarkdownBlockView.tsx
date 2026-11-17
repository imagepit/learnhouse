'use client'

import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import RichMarkdown from '@components/Objects/RichMarkdown/RichMarkdown'
import RichMarkdownField from '@components/Objects/RichMarkdown/RichMarkdownField'

export default function RichMarkdownBlockView({ node, updateAttributes }: NodeViewProps) {
  const options: unknown = useEditorProvider()
  const isEditable = typeof options === 'object' && options !== null &&
    'isEditable' in options && options.isEditable === true
  const source = typeof node.attrs.source === 'string' ? node.attrs.source : ''
  return <NodeViewWrapper contentEditable={false}>
    {isEditable
      ? <RichMarkdownField label="Markdown" format="markdown" value={source}
          onChange={source => updateAttributes({ source })} />
      : <RichMarkdown source={source} format="markdown" />}
  </NodeViewWrapper>
}
