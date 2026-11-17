import type {
  FileTreeCommentPart,
  FileTreeEntry,
  FileTreeEntryKind,
  FileTreeEntryStatus,
} from "./blocks";
import { parseAnnotations, type LineAnnotation } from "./annotations";
import { decodeCalloutLabel } from "./callout-label";

interface MutableFileTreeEntry {
  name: string;
  kind: FileTreeEntryKind;
  children?: MutableFileTreeEntry[];
  comment?: readonly FileTreeCommentPart[];
  callout?: { label: string };
  status?: FileTreeEntryStatus;
  emphasized?: boolean;
  highlighted?: boolean;
}

interface ParsedLine {
  depth: number;
  value: string;
  highlighted?: boolean;
}

export interface FileTreeFenceMeta {
  title?: string;
  icon?: "simple" | "colored";
}

/** file-tree/tree fenceのinfo文字列を専用語彙だけで厳格に解釈する。 */
export function parseFileTreeFenceMeta(raw: string | null | undefined): FileTreeFenceMeta | undefined {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return {};

  const result: FileTreeFenceMeta = {};
  const seen = new Set<string>();
  const pattern = /(title|icon)="([^"]*)"/uy;
  let cursor = 0;
  while (cursor < trimmed.length) {
    while (cursor < trimmed.length && /\s/u.test(trimmed[cursor])) cursor += 1;
    pattern.lastIndex = cursor;
    const match = pattern.exec(trimmed);
    if (!match || seen.has(match[1])) return undefined;
    seen.add(match[1]);
    if (match[1] === "title") {
      if (match[2]) result.title = match[2];
    } else if (match[2] === "simple" || match[2] === "colored") {
      result.icon = match[2];
    } else {
      return undefined;
    }
    cursor = pattern.lastIndex;
  }
  return result;
}

/** Theme Plume互換containerで使うMarkdown list形式だけを正規化する。 */
export function parseFileTreeList(source: string): FileTreeEntry[] | undefined {
  const lines = meaningfulLines(source);
  if (lines.length === 0) return undefined;

  const parsed: ParsedLine[] = [];
  for (const line of lines) {
    const match = line.match(/^([ \t]*)[-*+][ \t]+(.+)$/u);
    if (!match) return undefined;
    parsed.push({ depth: indentationWidth(match[1]), value: match[2] });
  }
  return buildTree(normalizeIndentDepths(parsed));
}

/** file-tree/tree fenceで使うlistまたはUnicode tree形式を正規化する。 */
export function parseFileTree(source: string): FileTreeEntry[] | undefined {
  const list = parseFileTreeList(source);
  if (list) return list;

  return parseUnicodeFileTree(source);
}

/** Unicode tree fenceを正規化し、renderer capability有効時だけhighlight行注釈を解釈する。 */
export function parseFileTreeFenceWithHighlights(
  source: string,
  options: { highlight?: boolean } = {},
): FileTreeEntry[] | undefined {
  const parsedAnnotations = parseAnnotations(source);
  if (parsedAnnotations.code === source) return parseFileTree(source);
  if (
    options.highlight !== true
    || parsedAnnotations.annotations.length === 0
    || parsedAnnotations.annotations.some((annotation) => annotation.kind !== "highlight")
  ) {
    return undefined;
  }
  if (parseFileTreeList(parsedAnnotations.code)) return undefined;

  return parseUnicodeFileTree(parsedAnnotations.code, parsedAnnotations.annotations);
}

function parseUnicodeFileTree(
  source: string,
  annotations: readonly LineAnnotation[] = [],
): FileTreeEntry[] | undefined {
  const lines = source.split(/\r?\n/u);

  const parsed: ParsedLine[] = [];
  let hasConnector = false;

  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    const match = line.match(/^((?:(?:│| )[ \t]{3})*)(?:(├──|└──)[ \t]+)?(.+)$/u);
    if (!match) return undefined;
    const prefixDepth = match[1].length / 4;
    const connector = match[2];
    hasConnector ||= connector !== undefined;
    const physicalLine = index + 1;
    const highlighted = annotations.some(
      (annotation) => physicalLine >= annotation.start && physicalLine <= annotation.end,
    );
    parsed.push({
      depth: prefixDepth + (connector ? 1 : 0),
      value: match[3],
      ...(highlighted ? { highlighted: true } : {}),
    });
  }

  if (parsed.length === 0 || !hasConnector) return undefined;
  const minimum = Math.min(...parsed.map((line) => line.depth));
  const tree = buildTree(parsed.map((line) => ({ ...line, depth: line.depth - minimum })));
  if (!tree) return undefined;
  if (tree[0]?.name !== ".") return containsDotEntry(tree) ? undefined : tree;
  if (tree.length !== 1 || tree[0].kind !== "directory" || !tree[0].children?.length) return undefined;
  if (containsDotEntry(tree[0].children)) return undefined;
  return [...tree[0].children];
}

function containsDotEntry(entries: readonly FileTreeEntry[]): boolean {
  return entries.some((entry) => entry.name === "." || containsDotEntry(entry.children ?? []));
}

function meaningfulLines(source: string): string[] {
  return source.split(/\r?\n/u).filter((line) => line.trim().length > 0);
}

function indentationWidth(value: string): number {
  return [...value].reduce((width, character) => width + (character === "\t" ? 2 : 1), 0);
}

function normalizeIndentDepths(lines: readonly ParsedLine[]): ParsedLine[] {
  const indents: number[] = [];
  return lines.map((line) => {
    let depth = indents.indexOf(line.depth);
    if (depth < 0) {
      while (indents.length > 0 && indents.at(-1)! > line.depth) indents.pop();
      if (indents.length > 0 && line.depth <= indents.at(-1)!) return { ...line, depth: -1 };
      indents.push(line.depth);
      depth = indents.length - 1;
    }
    return { ...line, depth };
  });
}

function buildTree(lines: readonly ParsedLine[]): FileTreeEntry[] | undefined {
  const roots: MutableFileTreeEntry[] = [];
  const parents: MutableFileTreeEntry[] = [];

  for (const line of lines) {
    if (line.depth < 0 || line.depth > parents.length) return undefined;
    const entry = parseEntry(line.value);
    if (!entry) return undefined;
    if (line.highlighted) entry.highlighted = true;

    if (line.depth === 0) {
      roots.push(entry);
    } else {
      const parent = parents[line.depth - 1];
      if (!parent) return undefined;
      parent.kind = "directory";
      parent.children ??= [];
      parent.children.push(entry);
    }

    parents.length = line.depth;
    parents.push(entry);
  }

  return roots.length > 0 ? roots : undefined;
}

function parseEntry(raw: string): MutableFileTreeEntry | undefined {
  let value = raw.trim();
  if (!value) return undefined;

  let callout: { label: string } | undefined;
  if (value.endsWith("]")) {
    const marker = value.lastIndexOf(" <--[");
    if (marker >= 0) {
      const label = decodeCalloutLabel(value.slice(marker + 5, -1));
      callout = { label };
      value = value.slice(0, marker).trimEnd();
    }
  }

  let status: FileTreeEntryStatus | undefined;
  if (value.startsWith("++ ")) {
    status = "added";
    value = value.slice(3);
  } else if (value.startsWith("-- ")) {
    status = "removed";
    value = value.slice(3);
  } else if (value.startsWith("** ")) {
    status = "modified";
    value = value.slice(3);
  }

  let comment: readonly FileTreeCommentPart[] | undefined;
  const commentMatch = value.match(/^(.*?)[ \t]+#[ \t]+(.+)$/u);
  if (commentMatch) {
    value = commentMatch[1].trimEnd();
    comment = parseCommentParts(commentMatch[2].trim());
  }

  let emphasized = false;
  if (value.startsWith("**") && value.endsWith("**") && value.length > 4) {
    emphasized = true;
    value = value.slice(2, -2);
  }

  const explicitDirectory = value.endsWith("/");
  if (explicitDirectory) value = value.slice(0, -1);
  if (!value) return undefined;

  const kind: FileTreeEntryKind = value === "..." || value === "…"
    ? "placeholder"
    : explicitDirectory
      ? "directory"
      : "file";
  return {
    name: value,
    kind,
    ...(comment ? { comment } : {}),
    ...(callout ? { callout } : {}),
    ...(status ? { status } : {}),
    ...(emphasized ? { emphasized: true } : {}),
  };
}

function parseCommentParts(value: string): readonly FileTreeCommentPart[] {
  if (/<[^>]*>|\[[^\]]*\]\([^)]*\)/u.test(value)) return [{ text: value }];
  const markers = [...value.matchAll(/\*\*/gu)];
  if (markers.length === 0 || markers.length % 2 !== 0) return [{ text: value }];

  const parts: FileTreeCommentPart[] = [];
  let cursor = 0;
  for (let index = 0; index < markers.length; index += 2) {
    const start = markers[index].index;
    const end = markers[index + 1].index;
    const emphasized = value.slice(start + 2, end);
    if (!emphasized) return [{ text: value }];
    if (start > cursor) parts.push({ text: value.slice(cursor, start) });
    parts.push({ text: emphasized, emphasized: true });
    cursor = end + 2;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor) });
  return parts;
}
