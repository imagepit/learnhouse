# IMAGEPIT rich Markdown source

Source revision: imagepit/design-system@8d0629a66b413a733993b9fe538a14e41b291508.

- The namesake files under `packages/md-react/src` supply the directive parser,
  file tree and steps normalization, and Shiki line decorations.
- `code-line-contract.ts` comes from `packages/ui/src`.
- `blocks.tsx` adapts the code block and file tree display to LearnHouse. The
  highlighter returns HAST so React can render text without injecting HTML.
- `PeleDiagram.tsx` adapts the SVG isolation approach in
  `packages/render-web/src/mermaid-diagram.tsx` for Pele.
- Styles use the existing LearnHouse palette and the step and code structure
  from `packages/web-style`.

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
