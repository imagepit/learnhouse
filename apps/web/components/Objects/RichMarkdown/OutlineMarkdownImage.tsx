'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize2 } from 'lucide-react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { OUTLINE_IMAGE_MAX_WIDTH } from '@services/media/activityImages'

export default function OutlineMarkdownImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)

  if (failed) {
    return <span role="status">{t('editor.blocks.image_block.load_failed')}{alt && ': ' + alt}</span>
  }

  return <span className="mx-auto block w-fit" style={{ maxWidth: `min(100%, ${OUTLINE_IMAGE_MAX_WIDTH}px)` }}>
    <Modal
      isDialogOpen={open}
      onOpenChange={setOpen}
      dialogTitle={t('editor.blocks.image_block.viewer_title')}
      minWidth="lg"
      minHeight="lg"
      dialogTrigger={
        <button type="button" className="group relative block max-w-full cursor-zoom-in"
          aria-label={t('editor.blocks.image_block.expand_image') + (alt ? ': ' + alt : '')}>
          <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer"
            onError={() => setFailed(true)} className="h-auto max-w-full rounded-lg" />
          <span className="absolute end-2 top-2 rounded-lg bg-black/60 p-2 text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
            <Maximize2 className="size-4" aria-hidden="true" />
          </span>
        </button>
      }
      dialogContent={
        <img src={src} alt={alt} referrerPolicy="no-referrer"
          className="mx-auto max-h-[80vh] max-w-full rounded-lg object-contain" />
      }
    />
  </span>
}
