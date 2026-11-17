// Parser for the `//addstart` … `//addend`-style line-annotation markers used inside training
// markdown fences (single-parser contract #6818). This module only extracts the annotation
// model out of raw fence text; turning that model into HTML classes is highlight.ts's job.

import { decodeCalloutLabel } from "./callout-label";

export type AnnotationKind = "add" | "del" | "highlight" | "focus" | "error" | "warning";

export interface LineAnnotation {
  kind: AnnotationKind;
  /** 1-based, inclusive. Counted against the code returned alongside — marker lines removed. */
  start: number;
  /** 1-based, inclusive. */
  end: number;
}

/** Redmine #7092: a single end-of-line `// <--[label]` callout. */
export interface LineCallout {
  /** 1-based. Counted against the code returned alongside — marker text removed. */
  line: number;
  /** calloutだけで構成される行の先頭ASCII space/tab。コピー用codeには含めない。 */
  indent?: string;
  label: string;
}

export type TurnCalloutPlacement = "before" | "after";
export type TurnCalloutIcon = "heroicons:arrow-turn-left-down" | "heroicons:arrow-turn-left-up";

/** `// v--[…]` / `// ^--[…]` が対象の実コード行へ付与する独立行callout。 */
export interface TurnCallout {
  /** 1-based. Counted against the code returned alongside — directive lines removed. */
  line: number;
  /** directive行の先頭にあるASCII space/tab。 */
  indent: string;
  label: string;
  placement: TurnCalloutPlacement;
  icon: TurnCalloutIcon;
}

export interface ParsedAnnotations {
  code: string;
  annotations: LineAnnotation[];
  callouts: LineCallout[];
  /** `turnCallouts: true`を指定した場合だけ返す。 */
  turnCallouts?: TurnCallout[];
}

/** The 6 supported kinds, in the contract's canonical order. */
export const ANNOTATION_KINDS: readonly AnnotationKind[] = ["add", "del", "highlight", "focus", "error", "warning"];

/** 対象行を覆う注釈種別を媒体共通のcanonical順で返す。 */
export function annotationKindsForLine(annotations: LineAnnotation[] | undefined, line: number): AnnotationKind[] {
  return ANNOTATION_KINDS.filter(
    (kind) => annotations?.some((annotation) => annotation.kind === kind && line >= annotation.start && line <= annotation.end) ?? false,
  );
}

type MarkerEdge = "start" | "end";

function buildMarkers(): Map<string, { kind: AnnotationKind; edge: MarkerEdge }> {
  const markers = new Map<string, { kind: AnnotationKind; edge: MarkerEdge }>();
  for (const kind of ANNOTATION_KINDS) {
    markers.set(`//${kind}start`, { kind, edge: "start" });
    markers.set(`//${kind}end`, { kind, edge: "end" });
  }
  return markers;
}

const MARKERS = buildMarkers();

/**
 * 行末calloutのマーカー文字列(#7092)。`// <--[`(CodeBlock全般)と`# <--[`(bashコメントの
 * 自然形。ExecPairのコマンド入力行向けに追加、#7092仕様改訂)の2種を受け付ける。単一パーサの
 * ため、この2種はCodeBlock側（Python/YAML等の`#`コメント言語含む）でも等しく有効になる
 * （副次効果。オーナー承認済み）。
 */
const CALLOUT_MARKERS = ["// <--[", "# <--["];
const FILE_TREE_CALLOUT_MARKER = " <--[";
const TURN_CALLOUT = /^([ \t]*)\/\/ ([v^])--\[([\s\S]*)\]\s*$/;

interface TurnCalloutDirective {
  indent: string;
  label: string;
  placement: TurnCalloutPlacement;
  icon: TurnCalloutIcon;
}

function parseTurnCalloutDirective(rawLine: string): TurnCalloutDirective | undefined {
  const match = rawLine.match(TURN_CALLOUT);
  if (!match) return undefined;
  return match[2] === "v"
    ? { indent: match[1], label: decodeCalloutLabel(match[3]), placement: "before", icon: "heroicons:arrow-turn-left-down" }
    : { indent: match[1], label: decodeCalloutLabel(match[3]), placement: "after", icon: "heroicons:arrow-turn-left-up" };
}

function isRealCodeLine(rawLine: string): boolean {
  return rawLine.trim() !== "" && !MARKERS.has(rawLine.trim()) && parseTurnCalloutDirective(rawLine) === undefined;
}

/** 除去対象の範囲マーカーだけを透過し、turn directiveから見た最初の意味行を返す。 */
function findTurnCalloutTargetIndex(
  rawLines: readonly string[],
  directiveIndex: number,
  placement: TurnCalloutPlacement,
): number | undefined {
  const step = placement === "before" ? 1 : -1;
  for (let index = directiveIndex + step; index >= 0 && index < rawLines.length; index += step) {
    if (MARKERS.has(rawLines[index].trim())) continue;
    return isRealCodeLine(rawLines[index]) ? index : undefined;
  }
  return undefined;
}

/**
 * 行末callout(#7092)を1行分だけ解釈する。`trimEnd()`が`]`で終わり、かつ行内に
 * `CALLOUT_MARKERS`のいずれかが含まれる行だけを対象にする。1行に複数マーカーがあっても
 * （マーカー種を問わず）行内で最後に出現したものだけを解釈し、手前の断片はコードとして
 * そのまま残す（意図的に多重解釈しない）。
 */
function stripLineCallout(
  rawLine: string,
  options?: { fileTreeCallouts?: boolean },
): { code: string; indent?: string; label?: string } {
  const trimmed = rawLine.trimEnd();
  if (!trimmed.endsWith("]")) return { code: rawLine };

  let markerStart = -1;
  let markerLength = 0;
  for (const marker of CALLOUT_MARKERS) {
    const idx = trimmed.lastIndexOf(marker);
    if (idx > markerStart) {
      markerStart = idx;
      markerLength = marker.length;
    }
  }
  if (options?.fileTreeCallouts) {
    const index = trimmed.lastIndexOf(FILE_TREE_CALLOUT_MARKER);
    const preceding = index > 0 ? trimmed[index - 1] : undefined;
    const isCommentContinuation = preceding === "#" || (preceding === "/" && trimmed[index - 2] === "/");
    if (index > markerStart && !isCommentContinuation) {
      markerStart = index;
      markerLength = FILE_TREE_CALLOUT_MARKER.length;
    }
  }
  if (markerStart === -1) return { code: rawLine };

  const label = decodeCalloutLabel(trimmed.slice(markerStart + markerLength, trimmed.length - 1));
  const indent = /^[ \t]*$/.test(trimmed.slice(0, markerStart)) ? trimmed.slice(0, markerStart) : undefined;
  let codeEnd = markerStart;
  while (codeEnd > 0 && /\s/.test(trimmed[codeEnd - 1])) codeEnd--;
  return { code: trimmed.slice(0, codeEnd), indent, label };
}

/**
 * Parses `//{kind}start` … `//{kind}end` marker lines out of a fenced code block's raw content.
 *
 * - A line counts as a marker when its `trim()`-ed text is an exact match (indentation before
 *   the marker is allowed; nothing else may share the line with it).
 * - Marker lines are removed from the returned `code`; annotation line numbers are 1-based
 *   against that already-stripped code, not the raw input.
 * - An unclosed start marker stays open through the end of the block (lenient — no error).
 * - Nesting is not supported: a second start of the same kind simply replaces the pending one,
 *   and a stray end with no open start of that kind is ignored.
 *
 * `options.callouts`を渡さない限り、`// <--[label]`/`# <--[label]`は一切解釈せず
 * 原文のまま通す。react.tsxはCodeBlockフェンス（全言語）とExecPairのコマンド入力行
 * （kind="command"のinputのみ）でだけこれをtrueにする — ExecPairの出力行とai-prompt
 * （入力・応答とも）はこの既定のまま、原文を素通しする（#7092仕様改訂）。
 * `fileTreeCallouts`は`tree` / `file-tree` fenceがCodeBlockへ戻るときだけbareな
 * ` <--[label]`記法を追加で許可する。通常CodeBlockへこの語彙を広げない。
 */
export function parseAnnotations(
  raw: string,
  options?: { callouts?: boolean; turnCallouts?: boolean; fileTreeCallouts?: boolean },
): ParsedAnnotations {
  const rawLines = raw.split("\n");
  const codeLines: string[] = [];
  const open = new Map<AnnotationKind, number>();
  const annotations: LineAnnotation[] = [];
  const callouts: LineCallout[] = [];
  const turnCallouts: TurnCallout[] = [];
  const calloutsEnabled = options?.callouts === true;
  const turnCalloutsEnabled = options?.turnCallouts === true;

  for (const [rawIndex, rawLine] of rawLines.entries()) {
    const marker = MARKERS.get(rawLine.trim());
    const turnDirective = turnCalloutsEnabled ? parseTurnCalloutDirective(rawLine) : undefined;
    if (turnDirective) {
      const targetIndex = findTurnCalloutTargetIndex(rawLines, rawIndex, turnDirective.placement);
      if (targetIndex !== undefined) {
        turnCallouts.push({
          ...turnDirective,
          line: turnDirective.placement === "before" ? codeLines.length + 1 : codeLines.length,
        });
        continue;
      }
    }
    if (!marker) {
      if (calloutsEnabled) {
        const { code, indent, label } = stripLineCallout(rawLine, { fileTreeCallouts: options?.fileTreeCallouts === true });
        codeLines.push(code);
        if (label !== undefined) callouts.push({ line: codeLines.length, ...(indent ? { indent } : {}), label });
      } else {
        codeLines.push(rawLine);
      }
      continue;
    }

    if (marker.edge === "start") {
      open.set(marker.kind, codeLines.length + 1);
      continue;
    }

    const start = open.get(marker.kind);
    if (start === undefined) continue; // stray //{kind}end with no open start: ignored (lenient)
    open.delete(marker.kind);
    if (codeLines.length >= start) annotations.push({ kind: marker.kind, start, end: codeLines.length });
  }

  // Unclosed start markers stay open through the end of the block.
  for (const [kind, start] of open) {
    if (codeLines.length >= start) annotations.push({ kind, start, end: codeLines.length });
  }

  annotations.sort((a, b) => a.start - b.start || a.end - b.end);
  return {
    code: codeLines.join("\n"),
    annotations,
    callouts,
    ...(turnCalloutsEnabled ? { turnCallouts } : {}),
  };
}
