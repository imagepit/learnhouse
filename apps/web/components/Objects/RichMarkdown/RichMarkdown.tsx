'use client'

import { memo, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Blockquote, BlockContent, PhrasingContent, Root } from 'mdast'
import PeleDiagram from './PeleDiagram'
import { AnnotatedCode, FileTree } from './vendor/blocks'
import { parseMarkdownDirectives, type MarkdownRootContent } from './vendor/directives'
import { parseFileTreeFenceMeta, parseFileTreeFenceWithHighlights } from './vendor/file-tree'
import { collectMarkdownSteps, splitMarkdownStepBody } from './vendor/steps'

export type TextFormat = 'plain' | 'markdown'
export const textFormat = (value: unknown): TextFormat => value === 'markdown' ? 'markdown' : 'plain'
export const MAX_MARKDOWN_LENGTH = 100_000

const CALLOUTS = new Set(['note', 'info', 'important', 'warning', 'caution', 'tip', 'syntax', 'danger', 'chapter-point', 'section-summary', 'chapter-summary', 'keyword'])

function paragraph(children: PhrasingContent[]): BlockContent {
  return { type: 'paragraph', children }
}

type RichBlock = Blockquote["children"][number]

function box(className: string, children: RichBlock[]): Blockquote {
  // A root can contain definitions. Block quotes can too, and hName maps
  // this authored block to a visually distinct div without emitting raw HTML.
  return { type: 'blockquote', children, data: { hName: 'div', hProperties: { className: className.split(" ") } } }
}

export function richMarkdownTree(source: string) {
  let nextTreeId = 0
  const fileTrees = new Map<number, Extract<MarkdownRootContent, { type: 'imagepitFileTree' }>>()
  function convert(nodes: readonly MarkdownRootContent[]): RichBlock[] {
    return nodes.flatMap((node): RichBlock[] => {
      if (node.type === 'imagepitFileTree') {
        const id = nextTreeId++
        fileTrees.set(id, node)
        return [{ type: 'code', lang: 'lh-internal-file-tree', value: '', data: { hProperties: { 'data-file-tree': id } } }]
      }
      if (node.type === 'imagepitDirective') {
        if (node.name === 'step') {
          const { leading, steps } = collectMarkdownSteps(node.children)
          return [box('lh-rich-steps', [
            ...convert(leading),
            ...steps.map((step, index) => {
              const { main, aside } = splitMarkdownStepBody(step.body)
              return box('lh-rich-step', [
                paragraph([{ type: 'strong', children: [{ type: 'text', value: `${index + 1}. ` }, ...step.title] }]),
                box('lh-rich-step-body', [box('lh-rich-step-main', convert(main)), ...(aside ? [box('lh-rich-step-aside', convert(aside))] : [])]),
              ])
            }),
          ])]
        }
        if (!CALLOUTS.has(node.name)) return convert(node.children)
        const label = node.title || node.name
        return [box(`lh-rich-callout lh-rich-callout-${node.name}`, [
          paragraph([{ type: 'strong', children: [{ type: 'text', value: label }] }]),
          ...convert(node.children),
        ])]
      }
      if (node.type === 'imagepitTocMarker' || node.type === 'imagepitCodeTree' || node.type === 'imagepitCustomDirective') return []
      if (node.type === 'code' && node.meta) {
        return [{ ...node, data: { ...node.data, hProperties: { 'data-fence-meta': node.meta } } }]
      }
      switch (node.type) {
        case 'blockquote': case 'code': case 'definition': case 'footnoteDefinition':
        case 'heading': case 'html': case 'list': case 'paragraph': case 'table':
        case 'thematicBreak':
          return [node]
        default:
          return []
      }
    })
  }
  const children = convert(parseMarkdownDirectives(source, { fileTree: true }).children)
  return { tree: { type: 'root', children } satisfies Root, fileTrees }
}

const RichMarkdown = memo(function RichMarkdown({ source, format, copyCode = true }: {
  source: string
  format?: TextFormat | null
  copyCode?: boolean
}) {
  const renderer = useMemo(() => {
    if (format !== 'markdown' || source.length > MAX_MARKDOWN_LENGTH) return null
    const { tree, fileTrees } = richMarkdownTree(source)
    const components: Components = {
      pre({ node, children }) {
        const code = node?.children.find(child => child.type === 'element' && child.tagName === 'code')
        if (!code || code.type !== 'element') return <pre>{children}</pre>
        const classes = code.properties.className
        const language = Array.isArray(classes) ? String(classes[0] ?? '').replace(/^language-/, '').toLowerCase() : ''
        const raw = code.children.map(child => child.type === 'text' ? child.value : '').join('').replace(/\n$/, '')
        if (language === 'mermaid') return <PeleDiagram source={raw} />
        if (language === 'file-tree' || language === 'tree') {
          const meta = code.properties['data-fence-meta']
          const title = parseFileTreeFenceMeta(typeof meta === 'string' ? meta : undefined)?.title
          const entries = parseFileTreeFenceWithHighlights(raw, { highlight: true })
          if (entries) return <FileTree entries={entries} title={title} />
        }
        const id = code.properties['data-file-tree']
        if (typeof id === 'number') {
          const fileTree = fileTrees.get(id)
          if (fileTree) return <FileTree entries={fileTree.entries} title={fileTree.title} />
        }
        return <AnnotatedCode source={raw} language={language} copy={copyCode} />
      },
    }
    return { tree, components }
  }, [format, source, copyCode])

  if (!renderer) return <div className="whitespace-pre-wrap break-words">{source}</div>
  return <div className="lh-rich-markdown">
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, () => () => renderer.tree]} components={renderer.components}>
      {source}
    </ReactMarkdown>
  </div>
})

export default RichMarkdown
