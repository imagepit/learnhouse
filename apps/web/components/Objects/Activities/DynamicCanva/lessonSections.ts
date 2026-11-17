import type { JSONContent } from '@tiptap/core'

export interface LessonHeading {
  id: string
  title: string
  level: number
}

export interface LessonSection {
  id: string
  title: string
  content: JSONContent
  headings: LessonHeading[]
}

function textContent(node: JSONContent): string {
  return node.text ?? (node.content ?? []).map(textContent).join('')
}

export function splitLessonSections(document: JSONContent | null): LessonSection[] {
  if (document?.type !== 'doc' || !Array.isArray(document.content)) return []

  const sections: LessonSection[] = []
  const used = new Set<string>()
  let intro: JSONContent[] = []
  let current: LessonSection | undefined

  function heading(node: JSONContent, level: number): LessonHeading {
    const title = textContent(node).trim()
    const slug = title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
    const prefix = level === 2 ? 'section-' : 'heading-'
    const stem = prefix + (slug || 'untitled')
    let id = stem
    for (let duplicate = 2; used.has(id); duplicate++) id = stem + '-' + duplicate
    used.add(id)
    return { id, title, level }
  }

  function labelSubheadings(node: JSONContent, headings: LessonHeading[]): JSONContent {
    const level = node.attrs?.level
    if (node.type === 'heading' && typeof level === 'number' && level >= 3 && level <= 6) {
      const item = heading(node, level)
      headings.push(item)
      return { ...node, attrs: { ...node.attrs, readerId: item.id } }
    }
    return node.content ? { ...node, content: node.content.map(child => labelSubheadings(child, headings)) } : node
  }

  for (const node of document.content) {
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const { id, title } = heading(node, 2)
      const headings: LessonHeading[] = []
      const body = intro.map(child => labelSubheadings(child, headings))
      body.push({ ...node, attrs: { ...node.attrs, readerId: id } })
      current = { id, title: title || String(sections.length + 1), content: { ...document, content: body }, headings }
      sections.push(current)
      intro = []
    } else if (current) {
      current.content.content?.push(labelSubheadings(node, current.headings))
    } else {
      intro.push(node)
    }
  }
  return sections
}

export function readerHref(sectionId: string, headingId?: string): string {
  const hash = new URLSearchParams({ section: sectionId })
  if (headingId) hash.set('heading', headingId)
  return '#' + hash.toString()
}

export function resolveReaderLocation(sections: LessonSection[], hash: string) {
  const params = new URLSearchParams(hash.slice(1))
  const selected = sections.find(section => section.id === params.get('section'))
  if (selected) {
    const heading = selected.headings.find(item => item.id === params.get('heading'))
    return { sectionId: selected.id, headingId: heading?.id }
  }

  // Accept direct links to a heading as well as the reader's own links.
  let anchor: string
  try {
    anchor = decodeURIComponent(hash.slice(1))
  } catch {
    anchor = ''
  }
  for (const section of sections) {
    if (section.id === anchor) return { sectionId: section.id }
    const heading = section.headings.find(item => item.id === anchor)
    if (heading) return { sectionId: section.id, headingId: heading.id }
  }
  return { sectionId: sections[0]?.id }
}
