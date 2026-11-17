import { useEffect, useState, type MouseEvent, type RefObject } from 'react'
import { Editor } from '@tiptap/react'
import { Check } from 'lucide-react'
import { readerHref, type LessonSection } from './lessonSections'

interface TableOfContentsProps {
  editor: Editor | null
}

interface HeadingItem {
  level: number
  text: string
  id: string
}


const TableOfContents = ({ editor }: TableOfContentsProps) => {
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!editor) return

    const updateHeadings = () => {
      const items: HeadingItem[] = []
      editor.state.doc.descendants((node) => {
        if (node.type.name.startsWith('heading')) {
          const level = node.attrs.level || 1
          const headingText = node.textContent || ''

          // Create slug from heading text (same logic as CustomHeading in DynamicCanva)
          const slug = headingText
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '') // Remove special characters
            .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
            .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens

          const id = slug ? `heading-${slug}` : `heading-${Math.random().toString(36).substr(2, 9)}`

          items.push({
            level,
            text: node.textContent,
            id,
          })
        }
      })
      setHeadings(items)
    }

    editor.on('update', updateHeadings)
    updateHeadings()

    return () => {
      editor.off('update', updateHeadings)
    }
  }, [editor])

  if (headings.length === 0) return null

  return (
    <div className="w-full bg-none border-none shadow-none p-0 m-0 font-[inherit] flex flex-col items-stretch h-fit">
      <ul className="!list-none !p-0 m-0">
        {headings.map((heading, index) => (
          <li
            key={index}
            className="toc-item my-2 !list-none flex items-start gap-2"
            style={{ paddingLeft: `${(heading.level - 1) * 1.2}rem` }}
          >
            <span className="toc-check"><Check size={15} strokeWidth={1.7} /></span>
            <a className={`toc-link toc-link-h${heading.level}`} href={`#${heading.id}`}>{heading.text}</a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default TableOfContents

// Based on the IMAGEPIT design-system Toc. This reader scopes observation to
// its active section and tracks the last heading above the fixed page header.
export function SectionTableOfContents({ sections, chapterLabel, current, body, onNavigate }: {
  sections: LessonSection[]
  chapterLabel?: string
  current: LessonSection
  body: RefObject<HTMLDivElement | null>
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const [active, setActive] = useState<string>()

  useEffect(() => {
    const root = body.current
    if (!root) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const offset = Number.parseFloat(getComputedStyle(root).scrollMarginTop) || 112
        let heading: string | undefined
        for (const item of current.headings) {
          const node = root.querySelector('#' + CSS.escape(item.id))
          if (node && node.getBoundingClientRect().top <= offset + 4) heading = item.id
        }
        setActive(heading)
      })
    }
    const resize = new ResizeObserver(update)
    resize.observe(root)
    window.addEventListener('scroll', update, { capture: true, passive: true })
    window.addEventListener('resize', update)
    update()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [body, current])

  function links() {
    return <ul className="lesson-section-toc-list">
      {sections.map(section => (
        <li key={section.id}>
          <a href={readerHref(section.id)} onClick={onNavigate}
            aria-current={section.id === current.id ? 'page' : undefined}>{section.title}</a>
          {section.id === current.id && section.headings.length > 0 && (
            <div className="ui-toc">
              <p className="ui-toc__title">このセクション</p>
              <ul>
                {section.headings.map(heading => <li key={heading.id} className="ui-toc__item">
                  <a href={readerHref(section.id, heading.id)} onClick={onNavigate}
                    aria-current={heading.id === active ? 'location' : undefined}
                    data-active={heading.id === active || undefined}>{heading.title}</a>
                </li>)}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  }

  return <aside className="lesson-section-rail">
    <nav aria-label="章の目次" className="lesson-section-toc-desktop">{links()}</nav>
    <details className="lesson-section-toc-mobile">
      <summary>{chapterLabel ? `${chapterLabel} の目次` : '章の目次'}</summary>
      <nav aria-label="章の目次">{links()}</nav>
    </details>
  </aside>
}
