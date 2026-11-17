'use client'

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { SectionTableOfContents } from './TableOfContents'
import { readerHref, resolveReaderLocation, type LessonSection } from './lessonSections'

interface ReaderProps {
  sections: LessonSection[]
  renderSection: (section: LessonSection) => ReactNode
}

export default function LessonSectionReader({ sections, renderSection }: ReaderProps) {
  const [hash, setHash] = useState('')
  const [ready, setReady] = useState(false)
  const reader = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const { sectionId, headingId } = resolveReaderLocation(sections, hash)
  const index = sections.findIndex(section => section.id === sectionId)
  const section = sections[index]
  const targetId = headingId ?? sectionId

  useEffect(() => {
    function sync() {
      setHash(window.location.hash)
      setReady(true)
    }
    sync()
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  useEffect(() => {
    if (!ready || !hash || !targetId || !body.current) return
    const root = body.current
    const anchor = targetId
    const observer = new MutationObserver(reveal)
    let frame = 0

    function reveal() {
      const target = root.querySelector<HTMLElement>('#' + CSS.escape(anchor))
      if (!target) return
      observer.disconnect()
      frame = requestAnimationFrame(() => {
        target.focus({ preventScroll: true })
        const scrollTarget = headingId ? target : reader.current
        scrollTarget?.scrollIntoView({ block: 'start' })
      })
    }

    observer.observe(root, { childList: true, subtree: true })
    reveal()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [hash, headingId, ready, targetId])

  if (!section) return null

  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.defaultPrevented) return
    event.preventDefault()
    const nextHash = event.currentTarget.getAttribute('href')
    if (!nextHash) return
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash)
      setHash(nextHash)
      return
    }
    const target = targetId && body.current?.querySelector<HTMLElement>('#' + CSS.escape(targetId))
    if (target) {
      target.focus({ preventScroll: true })
      const scrollTarget = headingId ? target : reader.current
      scrollTarget?.scrollIntoView({ block: 'start' })
    }
  }

  const previous = sections[index - 1]
  const next = sections[index + 1]
  return <div className="lesson-section-reader" ref={reader}>
    <SectionTableOfContents sections={sections} current={section} body={body} onNavigate={navigate} />
    <div className="lesson-section-body" ref={body}>
      {renderSection(section)}
      {(previous || next) && <nav className="lesson-section-nav" aria-label="セクション移動">
        {previous && <a href={readerHref(previous.id)} onClick={navigate}>
          <span>← 前のセクション</span><strong>{previous.title}</strong>
        </a>}
        {next && <a href={readerHref(next.id)} onClick={navigate} className="lesson-section-next">
          <span>次のセクション →</span><strong>{next.title}</strong>
        </a>}
      </nav>}
    </div>
  </div>
}
