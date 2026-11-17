# IMAGEPIT rich Markdown source

Source revision: imagepit/design-system@8d0629a66b413a733993b9fe538a14e41b291508.

- The namesake files under `packages/md-react/src` supply the directive parser,
  file tree and steps normalization, and Shiki line decorations.
- `code-line-contract.ts` comes from `packages/ui/src`.
- `blocks.tsx` adapts `packages/ui/src/file-tree.tsx` and `code-block.tsx`.
  The Markdown tree uses the standard file row, status and directory views.
  The code view renders the highlighter's HAST with React and copies clean code.
  `language-icon.tsx` uses the design system's Lucide file glyphs and shares
  that mapping with code headers.
- `RichMarkdown.tsx` emits the steps structure from `packages/ui/src/steps.tsx`
  and the learning callout structure from
  `packages/render-web/src/skins/learning/learning-callout.tsx`. Callout titles
  and tones follow that skin and `packages/md-react/src/callout-presentation.ts`.
  Icons use LearnHouse's existing Lucide dependency.
- `PeleDiagram.tsx` uses the diagram frame from `packages/ui/src/mermaid-diagram.tsx`
  with the existing sanitized Pele output and intrinsic sizing.
- `apps/web/styles/rich-markdown.css` scopes the learning callout rules from
  `packages/render-web/src/skins/learning.css` and the steps, file-tree, code-block,
  code-lines, Mermaid, copy button and Shiki rules from `packages/web-style/src`
  to `.lh-rich-markdown`. It includes the required declarations and their
  dependencies from `tokens/imagepit-web.css`. Line annotations use a Unicode
  arrow to keep the glyph independent of a bundled font.

The original packages use restricted distribution. Confirm redistribution rights
for this copy before release and include it in LearnHouse's corresponding source
(CORE-226). Build inputs are present in this checkout plus public dependencies.

Pele 1.13.0 is MIT, Copyright (c) 2026 kepano. The dependency retains its
license file. Source: https://github.com/obsidianmd/pele/tree/1.13.0.

The two arrow paths in `code-line-contract.ts` come from Heroicons
(`arrow-turn-left-down` and `arrow-turn-left-up`), MIT.
Source: https://github.com/tailwindlabs/heroicons.

```text
MIT License

Copyright (c) Tailwind Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```
