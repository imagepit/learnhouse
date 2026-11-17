import { Node } from '@tiptap/core'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import RichMarkdownBlockView from './RichMarkdownBlockView'

export default Node.create({
  name: 'blockRichMarkdown',
  group: 'block',
  atom: true,

  addAttributes() {
    return { source: { default: '' } }
  },

  addNodeView() {
    return lhNodeView(RichMarkdownBlockView)
  },

  renderHTML() {
    return ['div', { 'data-block': 'rich-markdown' }]
  },
})
