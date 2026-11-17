import { useMemo } from 'react'
import type { JSONContent } from '@tiptap/core'
import LessonSectionReader from './LessonSectionReader'
import { splitLessonSections } from './lessonSections'
import { useEditor, EditorContent } from '@tiptap/react'

import EditorOptionsProvider from '@components/Contexts/Editor/EditorContext'
import TableOfContents from './TableOfContents'
import { getActivityExtensions, normalizeActivityContent } from './activityExtensions'
import AICanvaToolkit from './AI/AICanvaToolkit'

interface Editor {
  content: string | JSONContent
  sectionReader?: boolean
  activity: any
  hideTableOfContents?: boolean
  // Passed by the activity/embed/board renderers so the video block can build
  // stream URLs even where the Org/Course React contexts aren't populated.
  courseUuid?: string
  orgUuid?: string
}

export default function Canva(props: Editor) {
  const document = useMemo(() => normalizeActivityContent(props.content), [props.content])
  const sections = useMemo(() => props.sectionReader ? splitLessonSections(document) : [], [document, props.sectionReader])

  if (sections.length) {
    return <LessonSectionReader sections={sections} renderSection={section => (
      <CanvaBody key={section.id} {...props} content={section.content} hideTableOfContents />
    )} />
  }
  return <CanvaBody {...props} content={document} />
}

function CanvaBody(props: Editor) {
  /**
   * Important Note : This is a workaround to enable user interaction features to be implemented easily, like text selection, AI features and other planned features, this is set to true but otherwise it should be set to false.
   * Another workaround is implemented below to disable the editor from being edited by the user by setting the caret-color to transparent and using a custom extension to filter out transactions that add/edit/remove text.
   * To let the various Custom Extensions know that the editor is not editable, React context (EditorOptionsProvider) will be used instead of props.extension.options.editable.
   */
  const isEditable = true

  const editor: any = useEditor({
    immediatelyRender: false,
    editable: isEditable,
    // The surface is contenteditable only so selection works (see above). On a
    // phone that would raise the keyboard and spellcheck squiggles on every
    // tap into the text, so ask for neither.
    editorProps: {
      attributes: {
        inputmode: 'none',
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
      },
    },
    extensions: getActivityExtensions(props),

    content: props.content,
  })

  return (
    <EditorOptionsProvider options={{ isEditable: false }}>
      <div className="w-full mx-auto">
        <AICanvaToolkit activity={props.activity} editor={editor} />
        <div className="canva-content-wrapper">
          {!props.hideTableOfContents && <TableOfContents editor={editor} />}
          <EditorContent editor={editor} />
        </div>
      </div>
    </EditorOptionsProvider>
  )
}
