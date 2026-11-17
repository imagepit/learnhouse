import { test, expect } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { render } from 'pele'
import RichMarkdown, { richMarkdownTree } from '../components/Objects/RichMarkdown/RichMarkdown'
import { highlightAnnotated } from '../components/Objects/RichMarkdown/vendor/highlight'

test('renders callouts, steps with divider and both file tree forms', () => {
  const markdown = [
    ':::note Caution', 'Check the branch.', ':::',
    '', ':::step', '1. Prepare the repository', '', '   Main text', '',
    '   <!--divider-->', '', '   Side text', ':::',
    '', ':::file-tree', '- root/', '  - README.md', ':::',
    '', '```tree title="Layout"', '.', '└── ++ docs.md <--[Read me]', '```',
  ].join('\n')
  const html = renderToStaticMarkup(createElement(RichMarkdown, { source: markdown, format: 'markdown' }))
  for (const text of ['rw-learning-callout--info', 'rw-learning-callout__icon', 'ui-step__marker', 'ui-step__aside', 'Side text', '<details open', 'ui-file-tree__icon', 'README.md', 'Layout', 'Read me']) {
    expect(html).toContain(text)
  }
})

test('leaves plain content alone and treats unsafe Markdown as text', () => {
  const source = '<script>alert(1)</script>\n\n[x](javascript:alert%281%29)\n\n**Bold**'
  const plain = renderToStaticMarkup(createElement(RichMarkdown, { source }))
  const rich = renderToStaticMarkup(createElement(RichMarkdown, { source, format: 'markdown' }))
  expect(plain).toContain('**Bold**')
  expect(rich).toContain('<strong>Bold</strong>')
  expect(rich).not.toContain('<script>')
  expect(rich).not.toContain('javascript:')
})

test('keeps code copy clean and places callouts on the highlighted line', async () => {
  const { code, tree } = await highlightAnnotated([
    '//highlightstart', '// v--[Before]', 'const x = 1 // <--[Same line]', '// ^--[After]', '//highlightend',
  ].join('\n'), 'javascript', { callouts: true, turnCallouts: true })
  expect(code).toBe('const x = 1')
  const rendered = JSON.stringify(tree)
  for (const text of ['line--highlight', 'Before', 'Same line', 'After']) expect(rendered).toContain(text)
})

test('Pele renders Mermaid graph placeholders and keeps separate SVG IDs', () => {
  const source = 'flowchart TB\n A["course <course-id>"] --> B[Preview]'
  expect(richMarkdownTree('```mermaid\n' + source + '\n```').tree.children[0].lang).toBe('mermaid')
  expect(render(source, { idPrefix: 'first-', links: false }).svg).toContain('&lt;course-id&gt;')
  expect(render(source, { idPrefix: 'second-', links: false }).svg).not.toContain('first-')
})
