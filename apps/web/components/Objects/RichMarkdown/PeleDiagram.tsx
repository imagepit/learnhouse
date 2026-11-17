'use client'

import { memo, useEffect, useId, useState } from 'react'
import DOMPurify from 'dompurify'

const MAX_SOURCE_LENGTH = 50_000
let pele: Promise<typeof import('pele')> | undefined

export function sanitizeDiagram(raw: string): SVGSVGElement {
  const fragment = DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'style', 'a', 'image', 'feImage', 'animate', 'animateMotion', 'animateTransform', 'set'],
    RETURN_DOM_FRAGMENT: true,
  })
  const svg = fragment.firstElementChild
  if (!(svg instanceof SVGSVGElement) || fragment.children.length !== 1) {
    throw new Error('Invalid diagram')
  }
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const { name, value } of [...element.attributes]) {
      const local = /^#[\w:.-]+$/.test(value)
      if (/^(?:xlink:)?href$/i.test(name) && !local) element.removeAttribute(name)
      // Allow CSS fragments for markers and gradients. CSS escapes and
      // comments are rejected because they can disguise a url() reference.
      if (/url\s*\(|@|\\|\/\*/i.test(value) && (
        /@|\\|\/\*/.test(value) || /url\s*\(/i.test(value.replace(/url\(\s*#[\w:.-]+\s*\)/gi, ''))
      ) && (name === 'style' || /url\s*\(/i.test(value))) {
        element.removeAttribute(name)
      }
    }
  }
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Mermaid図')
  svg.setAttribute('focusable', 'false')
  return svg
}

export default memo(function PeleDiagram({ source }: { source: string }) {
  const id = useId().replace(/[^a-z\d_-]/gi, '')
  const [result, setResult] = useState<{ source: string; svg?: string }>()
  useEffect(() => {
    if (!source.trim() || source.length > MAX_SOURCE_LENGTH) return
    let current = true
    pele ??= import('pele')
    pele.then(({ render }) => {
      if (!current) return
      const { svg } = render(source, { idPrefix: `lh-pele-${id}-`, links: false, images: false })
      setResult({ source, svg: sanitizeDiagram(svg).outerHTML })
    }).catch(() => {
      if (current) setResult({ source })
    })
    return () => { current = false }
  }, [source, id])

  const svg = result?.source === source && result.svg
  const invalid = source.length > MAX_SOURCE_LENGTH || !source.trim() || result?.source === source
  return <figure className="lh-rich-diagram ui-mermaid">
    <div className="ui-mermaid__canvas">
      {svg
        ? <div className="ui-mermaid__svg" dangerouslySetInnerHTML={{ __html: svg }} />
        : <pre className="ui-mermaid__fallback"><code>{source}</code></pre>}
    </div>
    {!svg && invalid && <figcaption className="ui-mermaid__error">Mermaid図を表示できませんでした。</figcaption>}
  </figure>
})
