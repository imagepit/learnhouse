import { addClassToHast, createHighlighterCore, type HighlighterCore, type ShikiTransformer } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import { createCssVariablesTheme } from "shiki";
import type { ElementContent, Root } from "hast";
import { CODE_LINE_CLASS, codeLineAnnotationClasses, mapCodeLineText, turnCalloutClasses } from "./code-line-contract";
import { annotationKindsForLine, parseAnnotations, type LineAnnotation, type LineCallout, type TurnCallout } from "./annotations";
import { createLineCalloutIcon } from "./line-callout-icon";

function calloutLabelChildren(value: string) {
  return mapCodeLineText<ElementContent>(
    value,
    (segment) => ({ type: "text" as const, value: segment }),
    () => ({ type: "element" as const, tagName: "br", properties: {}, children: [] }),
  );
}

// Major languages for training content. A curated, fine-grained bundle (not
// shiki's full ~200-grammar set) so cold start stays small on Cloudflare Workers.
const LANGUAGES = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "bash",
  "json",
  "yaml",
  "markdown",
  "html",
  "css",
  "scss",
  "sql",
  "go",
  "rust",
  "java",
  "dockerfile",
  "xml",
] as const;

// Token colors are wired to --ip-color-syntax-* in @imagepit/web-style,
// not Shiki's own theme hexes — see the `:root { --shiki-* }` block there.
const theme = createCssVariablesTheme({ name: "imagepit", variablePrefix: "--shiki-", fontStyle: true });

// `shiki`'s top-level entry statically imports the WASM oniguruma engine even
// when unused, and Cloudflare Workers (this site's deploy target — see README)
// disallows runtime WASM instantiation. `shiki/core` + the JS regex engine avoid
// that import entirely.
let highlighterPromise: Promise<HighlighterCore> | undefined;

function getHighlighter() {
  highlighterPromise ??= createHighlighterCore({
    langs: LANGUAGES.map((lang) => bundledLanguages[lang]),
    themes: [theme],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

// Turns parsed line annotations (packages/md-react/src/annotations.ts, //addstart-style markers, contract
// #6818) into `.line--{kind}` classes on each Shiki `.line` span, plus the `has-diff` /
// `has-focus` block-level markers @imagepit/web-style keys its CodeBlock styling off.
function annotationTransformer(annotations: LineAnnotation[]): ShikiTransformer {
  return {
    name: "imagepit-line-annotations",
    pre(hast) {
      if (annotations.some((annotation) => annotation.kind === "add" || annotation.kind === "del")) {
        addClassToHast(hast, "has-diff");
      }
      if (annotations.some((annotation) => annotation.kind === "focus")) {
        addClassToHast(hast, "has-focus");
      }
    },
    line(hast, line) {
      if (hast.children.length === 0) {
        hast.properties.dataCodeEmptyLine = "true";
      }
      for (const annotation of annotations) {
        if (line >= annotation.start && line <= annotation.end) {
          for (const className of codeLineAnnotationClasses([annotation.kind])) addClassToHast(hast, className);
        }
      }
    },
  };
}

/** 注釈の有無に関係なくShikiのcodeをcanonical行DOM rootへ入れる。 */
function codeLineRootTransformer(): ShikiTransformer {
  return {
    name: "imagepit-code-line-root",
    code(hast) {
      addClassToHast(hast, CODE_LINE_CLASS.root);
    },
  };
}

// 行末callout(#7092)を`.line-callout`としてShikiの各行末尾へ追記する。ラベルはhastの
// textノードとして挿入する — Shikiのシリアライザがエスケープするため、文字列連結でHTMLを
// 組むより先にXSSを塞げる（利用者が書いたラベル文字列をそのまま扱うための必須経路）。
function calloutTransformer(callouts: LineCallout[]): ShikiTransformer {
  const calloutByLine = new Map<number, LineCallout>();
  for (const callout of callouts) calloutByLine.set(callout.line, callout);
  return {
    name: "imagepit-line-callouts",
    line(hast, line) {
      const callout = calloutByLine.get(line);
      if (callout === undefined) return;
      hast.children.push({
        type: "element",
        tagName: "span",
        properties: { class: CODE_LINE_CLASS.endCallout },
        children: [
          ...(callout.indent ? [{
            type: "element" as const,
            tagName: "span",
            properties: { class: CODE_LINE_CLASS.turnCalloutIndent },
            children: [{ type: "text" as const, value: callout.indent }],
          }] : []),
          {
            type: "element",
            tagName: "span",
            properties: { class: CODE_LINE_CLASS.endCalloutArrow },
            children: [{ type: "text", value: "<--" }],
          },
          {
            type: "element",
            tagName: "span",
            properties: { class: CODE_LINE_CLASS.calloutLabel },
            children: calloutLabelChildren(callout.label),
          },
        ],
      });
    },
  };
}

// ターン矢印calloutはコード行の内側ではなく前後のsiblingへ出す。全行が揃ったcode hookで
// before / line / afterを1つのcanonical groupへまとめ、媒体に依存しない行境界を作る。
function codeLineGroupTransformer(turnCallouts: TurnCallout[], annotations: LineAnnotation[]): ShikiTransformer {
  const beforeByLine = new Map<number, TurnCallout[]>();
  const afterByLine = new Map<number, TurnCallout[]>();
  for (const callout of turnCallouts) {
    const collection = callout.placement === "before" ? beforeByLine : afterByLine;
    collection.set(callout.line, [...(collection.get(callout.line) ?? []), callout]);
  }
  const calloutElement = (callout: TurnCallout) => ({
    type: "element" as const,
    tagName: "span",
    properties: {
      class: turnCalloutClasses(callout.placement, annotationKindsForLine(annotations, callout.line)),
    },
    children: [
      { type: "element" as const, tagName: "span", properties: { class: CODE_LINE_CLASS.turnCalloutIndent }, children: [{ type: "text" as const, value: callout.indent }] },
      { type: "element" as const, tagName: "span", properties: { class: CODE_LINE_CLASS.turnCalloutIcon }, children: [createLineCalloutIcon(callout.icon)] },
      { type: "element" as const, tagName: "span", properties: { class: CODE_LINE_CLASS.calloutLabel }, children: calloutLabelChildren(callout.label) },
    ],
  });
  return {
    name: "imagepit-code-line-groups",
    code(hast) {
      const lines = hast.children.filter((child) => child.type === "element" && child.tagName === "span");
      const children = [];
      for (const [index, line] of lines.entries()) {
        const lineNumber = index + 1;
        const rows = [
          ...(beforeByLine.get(lineNumber) ?? []).map(calloutElement),
          line,
          ...(afterByLine.get(lineNumber) ?? []).map(calloutElement),
        ];
        const groupChildren = [];
        for (const [rowIndex, row] of rows.entries()) {
          if (rowIndex > 0) groupChildren.push({ type: "text" as const, value: "\n" });
          groupChildren.push(row);
        }
        children.push({
          type: "element" as const,
          tagName: "span",
          properties: { class: CODE_LINE_CLASS.group },
          children: groupChildren,
        });
      }
      hast.children = children;
    },
  };
}

export async function highlightCode(
  code: string,
  language: string,
  options?: { annotations?: LineAnnotation[]; callouts?: LineCallout[]; turnCallouts?: TurnCallout[] },
): Promise<Root> {
  const highlighter = await getHighlighter();
  const lang = (LANGUAGES as readonly string[]).includes(language) ? language : "text";
  const annotations = options?.annotations;
  const callouts = options?.callouts;
  const turnCallouts = options?.turnCallouts;
  const transformers: ShikiTransformer[] = [codeLineRootTransformer()];
  if (annotations?.length) transformers.push(annotationTransformer(annotations));
  if (callouts?.length) transformers.push(calloutTransformer(callouts));
  transformers.push(codeLineGroupTransformer(turnCallouts ?? [], annotations ?? []));
  return highlighter.codeToHast(code, {
    lang,
    theme: "imagepit",
    transformers,
  });
}

/**
 * parseAnnotations → highlightCode in one call: the entry point for markup that carries
 * //addstart-style markers (contract #6818). Used by the CodeBlock catalog page today and
 * used by the package's Markdown-to-React mapping.
 *
 * `options.callouts` / `turnCallouts`は既定false。react.tsxがCodeBlockとExecPairの
 * 4ロールを描画するときに明示的に有効化する。
 */
export async function highlightAnnotated(
  raw: string,
  language: string,
  options?: { callouts?: boolean; turnCallouts?: boolean; fileTreeCallouts?: boolean },
): Promise<{ code: string; tree: Root; annotations: LineAnnotation[]; callouts: LineCallout[]; turnCallouts: TurnCallout[] }> {
  const { code, annotations, callouts, turnCallouts } = parseAnnotations(raw, options);
  const resolvedTurnCallouts = turnCallouts ?? [];
  const tree = await highlightCode(code, language, { annotations, callouts, turnCallouts: resolvedTurnCallouts });
  return { code, tree, annotations, callouts, turnCallouts: resolvedTurnCallouts };
}
