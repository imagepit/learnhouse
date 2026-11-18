'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OUTLINE_IMAGE_MAX_WIDTH } from '@services/media/activityImages'
import { requestOutlinePreview } from '@services/media/outlineImagePreviews'

export default function OutlineImagePreview({ src, alt, width = OUTLINE_IMAGE_MAX_WIDTH, onClick }: {
  src: string
  alt: string
  width?: number
  onClick?: () => void
}) {
  const { t } = useTranslation()
  const placeholder = useRef<HTMLSpanElement>(null)
  const [preview, setPreview] = useState<string | null | undefined>()

  useEffect(() => {
    const element = placeholder.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') return requestOutlinePreview(src, setPreview)
    let cancel: (() => void) | undefined
    let disposed = false
    const observer = new IntersectionObserver(entries => {
      if (disposed || !entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      cancel = requestOutlinePreview(src, setPreview)
    }, { rootMargin: '160px 0px' })
    observer.observe(element)
    return () => {
      disposed = true
      observer.disconnect()
      cancel?.()
    }
  }, [src])

  if (preview === undefined) {
    return <span ref={placeholder} role="img" aria-label={alt || undefined}
      className="block max-w-full rounded-lg bg-neutral-100" style={{ width, height: 160 }} />
  }
  if (preview === null) {
    return <span role="status">{t('editor.blocks.image_block.load_failed')}{alt && ': ' + alt}</span>
  }
  return <img src={preview} alt={alt} referrerPolicy="no-referrer"
    className="h-auto max-w-full rounded-lg" onClick={onClick}
    onError={() => setPreview(preview === src ? null : src)} />
}
