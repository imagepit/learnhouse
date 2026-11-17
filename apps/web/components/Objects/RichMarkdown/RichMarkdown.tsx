'use client'

import { memo, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Box, CircleAlert, Info, Lightbulb, NotebookPen, TriangleAlert } from 'lucide-react'
import type { Blockquote, BlockContent, PhrasingContent, Root } from 'mdast'
import PeleDiagram from './PeleDiagram'
import OutlineMarkdownImage from './OutlineMarkdownImage'
import { isOutlineActivityImagePath } from '@services/media/activityImages'
import { AnnotatedCode, FileTree } from './vendor/blocks'
import { parseMarkdownDirectives, type MarkdownRootContent } from './vendor/directives'
import { parseFileTreeFenceMeta, parseFileTreeFenceWithHighlights } from './vendor/file-tree'
import { collectMarkdownSteps, splitMarkdownStepBody } from './vendor/steps'

export type TextFormat = 'plain' | 'markdown'
export const textFormat = (value: unknown): TextFormat => value === 'markdown' ? 'markdown' : 'plain'
export const MAX_MARKDOWN_LENGTH = 100_000

const CALLOUTS = new Map([
  ['note', { tone: 'info', label: 'NOTE', Icon: NotebookPen }],
  ['info', { tone: 'info', label: 'INFO', Icon: Info }],
  ['important', { tone: 'warning', label: '重要', Icon: CircleAlert }],
  ['warning', { tone: 'warning', label: '警告', Icon: TriangleAlert }],
  ['caution', { tone: 'warning', label: '注意', Icon: TriangleAlert }],
  ['tip', { tone: 'success', label: 'TIP', Icon: Lightbulb }],
  ['syntax', { tone: 'syntax', label: '構文', Icon: Box }],
  ['danger', { tone: 'destructive', label: '危険', Icon: CircleAlert }],
  ['chapter-point', { tone: 'info', label: 'この章のポイント', Icon: Info }],
  ['section-summary', { tone: 'info', label: 'このセクションのまとめ', Icon: Info }],
  ['chapter-summary', { tone: 'info', label: 'この章のまとめ', Icon: Info }],
  ['keyword', { tone: 'syntax', label: '用語', Icon: Box }],
])

type RichBlock = Blockquote['children'][number]

function box(hName: string, className: string, children: RichBlock[], hProperties = {}): Blockquote {
  return { type: 'blockquote', children, data: { hName, hProperties: { className: className.split(' '), ...hProperties } } }
}

function label(hName: string, className: string, children: PhrasingContent[], hProperties = {}): BlockContent {
  return { type: 'paragraph', children, data: { hName, hProperties: { className: [className], ...hProperties } } }
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
          return [
            ...convert(leading),
            box('ol', 'ui-steps', steps.map((step, index) => {
              const { main, aside } = splitMarkdownStepBody(step.body)
              const content = aside ? [
                box('div', 'ui-step__main', convert(main)),
                box('div', 'ui-step__aside', convert(aside)),
              ] : convert(main)
              return box('li', 'ui-step', [
                label('span', 'ui-step__marker', [{ type: 'text', value: String(index + 1) }], { 'aria-hidden': true }),
                box('div', 'ui-step__content', [
                  label('h3', 'ui-step__title', step.title),
                  box('div', aside ? 'ui-step__body ui-step__body--columns' : 'ui-step__body', content),
                ]),
              ])
            })),
          ]
        }
        const callout = CALLOUTS.get(node.name)
        if (!callout) return convert(node.children)
        const title = node.title || callout.label
        return [box('aside', `rw-learning-callout rw-learning-callout--${callout.tone}`, [
          label('p', 'rw-learning-callout__title', [{ type: 'text', value: title }], { 'data-callout-title': node.name }),
          box('div', 'rw-learning-callout__body', convert(node.children)),
        ], { 'aria-label': title, 'data-variant': node.name })]
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
      img({ node: _node, src, alt, ...props }) {
        if (typeof src === 'string' && isOutlineActivityImagePath(src)) {
          return <OutlineMarkdownImage key={src} src={src} alt={alt ?? ''} />
        }
        return <img {...props} src={src} alt={alt} />
      },
      p({ node, children, ...props }) {
        const variant = node?.properties['data-callout-title']
        const Icon = typeof variant === 'string' ? CALLOUTS.get(variant)?.Icon : undefined
        return <p {...props}>
          {Icon && <span className="rw-learning-callout__icon" aria-hidden="true"><Icon /></span>}
          {children}
        </p>
      },
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
