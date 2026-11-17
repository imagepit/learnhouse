import type { Root, RootContent } from "mdast";
import type { FileTreeEntry } from "./blocks";
import { parseCodeTree, type ParsedCodeTree, type ParsedCodeTreeFile } from "./code-tree";
import { parseFileTreeList } from "./file-tree";
import { parseMarkdownBase } from "./parser-base";

export const ADMONITION_NAMES = [
  "note",
  "info",
  "important",
  "warning",
  "caution",
  "tip",
  "syntax",
  "danger",
  "chapter-point",
  "section-summary",
  "chapter-summary",
  "keyword",
  "chat",
  "quiz",
  "question",
  "select",
  "correct",
] as const;
export const DIRECTIVE_NAMES = [...ADMONITION_NAMES, "speech-left", "speech-right", "step"] as const;
export type MarkdownAdmonitionName = (typeof ADMONITION_NAMES)[number];
export type MarkdownDirectiveName = (typeof DIRECTIVE_NAMES)[number];

export interface MarkdownSpeechHeader {
  avatar?: string;
  name?: string;
  title?: string;
}

export interface MarkdownDirectiveNode {
  type: "imagepitDirective";
  name: MarkdownDirectiveName;
  title?: string;
  speech?: MarkdownSpeechHeader;
  children: MarkdownRootContent[];
}

/**
 * A consumer-registered directive (`::name{attrs}` leaf or
 * `:::name{attrs} title ... :::` container). `attributes` values are always
 * strings (no boolean/number coercion). Leaf nodes have no children or title.
 */
export interface MarkdownCustomDirectiveNode {
  type: "imagepitCustomDirective";
  name: string;
  attributes: Record<string, string>;
  title?: string;
  children: MarkdownRootContent[];
}

/** A medium-neutral request to render this document's table of contents here. */
export interface MarkdownTocMarkerNode {
  type: "imagepitTocMarker";
  position?: RootContent["position"];
}

export interface MarkdownFileTreeNode {
  type: "imagepitFileTree";
  entries: readonly FileTreeEntry[];
  title?: string;
  icon?: "simple" | "colored";
}

export interface MarkdownCodeTreeNode {
  type: "imagepitCodeTree";
  files: readonly ParsedCodeTreeFile[];
  initialPath: string;
  title?: string;
  height?: string;
}

export type MarkdownRootContent =
  | RootContent
  | MarkdownDirectiveNode
  | MarkdownCustomDirectiveNode
  | MarkdownCodeTreeNode
  | MarkdownFileTreeNode
  | MarkdownTocMarkerNode;
export type MarkdownRoot = Omit<Root, "children"> & { children: MarkdownRootContent[] };

export interface ParseMarkdownDirectivesOptions {
  /** Directive names accepted in addition to the fixed vocabulary. Must not collide with it. */
  customNames?: ReadonlySet<string>;
  /** Theme Plume互換File Treeの専用container解釈を有効にする。 */
  fileTree?: boolean;
  /** Theme Plume互換Code Treeの専用container解釈を有効にする。 */
  codeTree?: boolean;
}

interface DirectiveOpener {
  colonCount: 3 | 4;
  name: MarkdownDirectiveName;
  title?: string;
}

interface CustomContainerOpener {
  colonCount: 3 | 4;
  name: string;
  attributes: Record<string, string>;
  title?: string;
}

interface CustomLeafDirective {
  name: string;
  attributes: Record<string, string>;
}

interface FileTreeOpener {
  colonCount: 3 | 4;
  title?: string;
  icon?: "simple" | "colored";
}

interface CodeTreeOpener {
  colonCount: 3 | 4;
  attributes: string;
}

type FoundDirective =
  | { start: number; end: number; kind: "known"; opener: DirectiveOpener }
  | { start: number; end: number; kind: "customContainer"; opener: CustomContainerOpener }
  | { start: number; end: number; kind: "customLeaf"; leaf: CustomLeafDirective }
  | { start: number; end: number; kind: "codeTree"; codeTree: ParsedCodeTree }
  | { start: number; end: number; kind: "fileTree"; opener: FileTreeOpener; entries: readonly FileTreeEntry[] };

interface GenericDirectiveOpener {
  colonCount: 3 | 4;
}

const DIRECTIVE_NAME_SET = new Set<string>(DIRECTIVE_NAMES);
const KNOWN_OPENER_RE = new RegExp(
  `^(:{3,4})(${DIRECTIVE_NAMES.join("|")})(?:\\[(.*?)\\]|[ \\t]+(.*?))?[ \\t]*$`,
  "u",
);
const FENCE_START = /^( {0,3})(`{3,}|~{3,})/u;
const FENCE_CLOSE = /^( {0,3})(`{3,}|~{3,})[ \t]*$/u;
const NO_CUSTOM_NAMES: ReadonlySet<string> = new Set();
const CUSTOM_CONTAINER_OPENER_RE = /^(:{3,4})([A-Za-z][\w-]*)(?:\{(.*)\})?(?:[ \t]+(.*?))?[ \t]*$/u;
const CUSTOM_LEAF_DIRECTIVE_RE = /^::(?!:)([A-Za-z][\w-]*)(?:\{(.*)\})?[ \t]*$/u;

/**
 * Parse only completed, known root-level directive blocks. All other content is delegated
 * unchanged to the CommonMark/GFM parser, including unknown and unclosed directive text.
 * `customNames` opts a consumer-registered vocabulary into the same container/leaf scanning;
 * names outside that set (and unregistered leaf/container syntax) pass through as plain text.
 */
export function parseMarkdownDirectives(
  markdown: string,
  options: ParseMarkdownDirectivesOptions = {},
): MarkdownRoot {
  const customNames = options.customNames ?? NO_CUSTOM_NAMES;
  assertNoCustomNameCollision(customNames);
  const footnoteMarkers = collectFootnoteMarkers(
    markdown,
    customNames,
    options.fileTree ?? false,
    options.codeTree ?? false,
  );
  return parseMarkdownDirectivesInternal(
    markdown,
    true,
    customNames,
    options.fileTree ?? false,
    options.codeTree ?? false,
    footnoteMarkers,
  );
}

function assertNoCustomNameCollision(customNames: ReadonlySet<string>): void {
  for (const name of customNames) {
    if (DIRECTIVE_NAME_SET.has(name)) {
      throw new Error(`カスタムdirective名 "${name}" は固定語彙と衝突しています`);
    }
  }
}

export interface LocatedMarkdownDirective {
  startLine: number;
  endLine: number;
  name: MarkdownDirectiveName;
  title?: string;
  colonCount: 3 | 4;
}

/**
 * 開始行から、入れ子とcode fenceを正本規則で辿った閉じ行を返す。未閉じ・未知名はundefined。
 * Printの範囲確定はこの関数だけを使い、remarkツリーの閉じタグ探索を再実装しない。
 */
export function locateMarkdownDirective(markdown: string, startLine: number): LocatedMarkdownDirective | undefined {
  const lines = markdown.split(/\r?\n/u);
  const known = readKnownOpener(lines[startLine] ?? "");
  if (!known) return undefined;
  const endLine = findDirectiveEnd(lines, startLine, known.colonCount, false, false);
  if (endLine === undefined) return undefined;
  return {
    startLine,
    endLine,
    name: known.name,
    colonCount: known.colonCount,
    ...(known.title ? { title: known.title } : {}),
  };
}

function parseMarkdownDirectivesInternal(
  markdown: string,
  allowTocMarker: boolean,
  customNames: ReadonlySet<string>,
  allowFileTree: boolean,
  allowCodeTree: boolean,
  footnoteMarkers: readonly string[] | undefined,
): MarkdownRoot {
  const lines = markdown.split(/\r?\n/u);
  const directives = findDirectives(lines, customNames, allowFileTree, allowCodeTree);

  if (directives.length === 0) return parseMarkdownSegment(markdown, allowTocMarker, footnoteMarkers);

  const children: MarkdownRootContent[] = [];
  let lineCursor = 0;

  for (const directive of directives) {
    appendMarkdown(children, lines.slice(lineCursor, directive.start).join("\n"), allowTocMarker, footnoteMarkers);

    if (directive.kind === "customLeaf") {
      children.push({
        type: "imagepitCustomDirective",
        name: directive.leaf.name,
        attributes: directive.leaf.attributes,
        children: [],
      });
      lineCursor = directive.end + 1;
      continue;
    }

    const body = lines.slice(directive.start + 1, directive.end).join("\n");

    if (directive.kind === "codeTree") {
      children.push({ type: "imagepitCodeTree", ...directive.codeTree });
      lineCursor = directive.end + 1;
      continue;
    }

    if (directive.kind === "fileTree") {
      children.push({
        type: "imagepitFileTree",
        entries: directive.entries,
        ...(directive.opener.title ? { title: directive.opener.title } : {}),
        ...(directive.opener.icon ? { icon: directive.opener.icon } : {}),
      });
      lineCursor = directive.end + 1;
      continue;
    }

    if (directive.kind === "customContainer") {
      children.push({
        type: "imagepitCustomDirective",
        name: directive.opener.name,
        attributes: directive.opener.attributes,
        ...(directive.opener.title ? { title: directive.opener.title } : {}),
        children: parseMarkdownDirectivesInternal(
          body,
          false,
          customNames,
          allowFileTree,
          allowCodeTree,
          footnoteMarkers,
        ).children,
      });
      lineCursor = directive.end + 1;
      continue;
    }

    const title = directive.opener.title;
    const node: MarkdownDirectiveNode = {
      type: "imagepitDirective",
      name: directive.opener.name,
      ...(title ? { title } : {}),
      ...(isSpeechDirective(directive.opener.name) ? { speech: parseSpeechHeader(title ?? "") } : {}),
      children: parseMarkdownDirectivesInternal(
        body,
        false,
        customNames,
        allowFileTree,
        allowCodeTree,
        footnoteMarkers,
      ).children,
    };
    children.push(node);
    lineCursor = directive.end + 1;
  }

  appendMarkdown(children, lines.slice(lineCursor).join("\n"), allowTocMarker, footnoteMarkers);
  return { type: "root", children };
}

export function parseSpeechHeader(header: string): MarkdownSpeechHeader {
  const fields = header.split("|").map((field) => field.trim());
  if (fields.length === 1) return fields[0] ? { title: fields[0] } : {};

  const [name, avatar, ...titleFields] = fields;
  const title = titleFields.join(" | ").trim();
  return {
    ...(name ? { name } : {}),
    ...(avatar ? { avatar } : {}),
    ...(title ? { title } : {}),
  };
}

function appendMarkdown(
  target: MarkdownRootContent[],
  markdown: string,
  allowTocMarker: boolean,
  footnoteMarkers: readonly string[] | undefined,
): void {
  if (markdown.trim().length === 0) return;
  target.push(...parseMarkdownSegment(markdown, allowTocMarker, footnoteMarkers).children);
}

function parseMarkdownSegment(
  markdown: string,
  allowTocMarker: boolean,
  footnoteMarkers: readonly string[] | undefined,
): MarkdownRoot {
  const appendix = footnoteMarkers && footnoteMarkers.length > 0
    ? `\n\n${footnoteMarkers.join("\n\n")}`
    : "";
  const syntheticStart = markdown.length + (appendix.length > 0 ? 2 : 0);
  const root = parseMarkdownBase(`${markdown}${appendix}`);
  const authoredChildren = root.children.filter(
    (node) => !isSyntheticFootnoteDefinition(node, syntheticStart),
  );
  const authoredRoot = appendix.length > 0 ? { ...root, children: authoredChildren } : root;
  if (!allowTocMarker) return authoredRoot as MarkdownRoot;
  const children = authoredRoot.children.map((node): MarkdownRootContent => {
    if (!isStandaloneTocMarker(node, markdown)) return node;
    return { type: "imagepitTocMarker", position: node.position };
  });
  return { ...authoredRoot, children };
}

function isSyntheticFootnoteDefinition(node: RootContent, syntheticStart: number): boolean {
  return node.type === "footnoteDefinition" && (node.position?.start.offset ?? -1) >= syntheticStart;
}

/**
 * Collect authored GFM footnote markers using the same directive boundaries as the renderer.
 * Only the marker is appended: the authored definition remains in the parsed AST and registry.
 */
function collectFootnoteMarkers(
  markdown: string,
  customNames: ReadonlySet<string>,
  allowFileTree: boolean,
  allowCodeTree: boolean,
  topLevel = true,
): string[] | undefined {
  const lines = markdown.split(/\r?\n/u);
  const directives = findDirectives(lines, customNames, allowFileTree, allowCodeTree);
  if (directives.length === 0) {
    if (topLevel) return undefined;
    const nestedMarkers: string[] = [];
    collectFootnoteMarkersFromMarkdown(markdown, nestedMarkers);
    return nestedMarkers;
  }

  const markers: string[] = [];
  let lineCursor = 0;

  for (const directive of directives) {
    collectFootnoteMarkersFromMarkdown(lines.slice(lineCursor, directive.start).join("\n"), markers);

    if (directive.kind === "customContainer" || directive.kind === "known") {
      markers.push(
        ...(collectFootnoteMarkers(
          lines.slice(directive.start + 1, directive.end).join("\n"),
          customNames,
          allowFileTree,
          allowCodeTree,
          false,
        ) ?? []),
      );
    }

    lineCursor = directive.end + 1;
  }

  collectFootnoteMarkersFromMarkdown(lines.slice(lineCursor).join("\n"), markers);
  return markers;
}

function collectFootnoteMarkersFromMarkdown(markdown: string, target: string[]): void {
  if (markdown.trim().length === 0) return;

  const root = parseMarkdownBase(markdown);
  walkMarkdownNodes(root.children, (node) => {
    if (node.type !== "footnoteDefinition") return;
    const start = node.position?.start.offset;
    if (start === undefined) return;
    const marker = sliceFootnoteMarker(markdown, start);
    if (marker !== undefined) target.push(marker);
  });
}

function walkMarkdownNodes(nodes: readonly unknown[], visit: (node: RootContent) => void): void {
  for (const candidate of nodes) {
    if (!candidate || typeof candidate !== "object" || !("type" in candidate) || typeof candidate.type !== "string") {
      continue;
    }
    const node = candidate as RootContent;
    visit(node);
    if ("children" in node && Array.isArray(node.children)) walkMarkdownNodes(node.children, visit);
  }
}

function sliceFootnoteMarker(markdown: string, start: number): string | undefined {
  let escaped = false;
  const lineEnd = markdown.indexOf("\n", start);
  const end = lineEnd === -1 ? markdown.length : lineEnd;

  for (let index = start; index + 1 < end; index += 1) {
    const character = markdown[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "]" && markdown[index + 1] === ":") return markdown.slice(start, index + 2);
  }
  return undefined;
}

function isStandaloneTocMarker(node: RootContent, markdown: string): boolean {
  if (node.type !== "paragraph" || node.children.length !== 1 || node.children[0].type !== "text") return false;
  if (node.children[0].value !== "{{ toc }}") return false;

  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return false;
  return /^\{\{ toc \}\}[ \t]*$/u.test(markdown.slice(start, end));
}

function findDirectives(
  lines: readonly string[],
  customNames: ReadonlySet<string>,
  allowFileTree: boolean,
  allowCodeTree: boolean,
): FoundDirective[] {
  const found: FoundDirective[] = [];
  let fence: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    fence = updateFence(fence, lines[index]);
    if (fence) continue;

    const codeTree = allowCodeTree ? readCodeTreeOpener(lines[index]) : undefined;
    if (codeTree) {
      const end = findDirectiveEnd(lines, index, codeTree.colonCount, allowFileTree, allowCodeTree);
      const parsed = end === undefined
        ? undefined
        : parseCodeTree(lines.slice(index + 1, end).join("\n"), codeTree.attributes);
      if (end !== undefined && parsed) {
        found.push({ start: index, end, kind: "codeTree", codeTree: parsed });
        index = end;
        continue;
      }
    }

    const fileTree = allowFileTree ? readFileTreeOpener(lines[index]) : undefined;
    if (fileTree) {
      const end = findDirectiveEnd(lines, index, fileTree.colonCount, allowFileTree, allowCodeTree);
      const entries = end === undefined ? undefined : parseFileTreeList(lines.slice(index + 1, end).join("\n"));
      if (end !== undefined && entries) {
        found.push({ start: index, end, kind: "fileTree", opener: fileTree, entries });
        index = end;
        continue;
      }
    }

    const known = readKnownOpener(lines[index]);
    if (known) {
      const end = findDirectiveEnd(lines, index, known.colonCount, allowFileTree, allowCodeTree);
      if (end !== undefined) {
        found.push({ start: index, end, kind: "known", opener: known });
        index = end;
        continue;
      }
    }

    const customContainer = readCustomContainerOpener(lines[index], customNames);
    if (customContainer) {
      const end = findDirectiveEnd(lines, index, customContainer.colonCount, allowFileTree, allowCodeTree);
      if (end !== undefined) {
        found.push({ start: index, end, kind: "customContainer", opener: customContainer });
        index = end;
        continue;
      }
    }

    const leaf = readCustomLeafDirective(lines[index], customNames);
    if (leaf) found.push({ start: index, end: index, kind: "customLeaf", leaf });
  }

  return found;
}

function findDirectiveEnd(
  lines: readonly string[],
  start: number,
  colonCount: 3 | 4,
  allowFileTree: boolean,
  allowCodeTree: boolean,
): number | undefined {
  const stack: Array<3 | 4> = [colonCount];
  let fence: string | undefined;

  for (let index = start + 1; index < lines.length; index += 1) {
    fence = updateFence(fence, lines[index]);
    if (fence) continue;

    const nestedCodeTree = allowCodeTree ? readCodeTreeOpener(lines[index]) : undefined;
    const nestedFileTree = allowFileTree ? readFileTreeOpener(lines[index]) : undefined;
    const nested = nestedCodeTree ?? nestedFileTree ?? readGenericOpener(lines[index]);
    if (nested) {
      stack.push(nested.colonCount);
      continue;
    }

    const closing = readClosing(lines[index]);
    if (!closing || closing !== stack.at(-1)) continue;
    stack.pop();
    if (stack.length === 0) return index;
  }

  return undefined;
}

function readCodeTreeOpener(line: string): CodeTreeOpener | undefined {
  const match = line.match(/^(:{3,4})[ \t]*code-tree(?:[ \t]+(.*?))?[ \t]*$/u);
  return match
    ? { colonCount: match[1].length as 3 | 4, attributes: match[2] ?? "" }
    : undefined;
}

function readKnownOpener(line: string): DirectiveOpener | undefined {
  const match = line.match(KNOWN_OPENER_RE);
  if (!match) return undefined;
  const name = match[2];
  if (!DIRECTIVE_NAME_SET.has(name)) return undefined;
  const title = match[3] ?? match[4];
  return {
    colonCount: match[1].length as 3 | 4,
    name: name as MarkdownDirectiveName,
    ...(title?.trim() ? { title: title.trim() } : {}),
  };
}

function readFileTreeOpener(line: string): FileTreeOpener | undefined {
  const match = line.match(/^(:{3,4})[ \t]*file-tree(?:[ \t]+(.*?))?[ \t]*$/u);
  if (!match) return undefined;
  const attributes = parseFileTreeAttributes(match[2] ?? "");
  return attributes ? { colonCount: match[1].length as 3 | 4, ...attributes } : undefined;
}

function parseFileTreeAttributes(raw: string): Omit<FileTreeOpener, "colonCount"> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const result: Omit<FileTreeOpener, "colonCount"> = {};
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

function readGenericOpener(line: string): GenericDirectiveOpener | undefined {
  const match = line.match(/^(:{3,4})([A-Za-z][\w-]*)(?:(?:\[.*?\]|\{.*\})(?:[ \t]+.*?)?|[ \t]+.*?)?[ \t]*$/u);
  return match ? { colonCount: match[1].length as 3 | 4 } : undefined;
}

function readCustomContainerOpener(line: string, customNames: ReadonlySet<string>): CustomContainerOpener | undefined {
  const match = line.match(CUSTOM_CONTAINER_OPENER_RE);
  if (!match) return undefined;
  const name = match[2];
  if (!customNames.has(name)) return undefined;
  const attributes = parseCustomAttributes(match[3] ?? "");
  const title = match[4]?.trim();
  return attributes
    ? {
        colonCount: match[1].length as 3 | 4,
        name,
        attributes,
        ...(title ? { title } : {}),
      }
    : undefined;
}

function readCustomLeafDirective(line: string, customNames: ReadonlySet<string>): CustomLeafDirective | undefined {
  const match = line.match(CUSTOM_LEAF_DIRECTIVE_RE);
  if (!match) return undefined;
  const name = match[1];
  if (!customNames.has(name)) return undefined;
  const attributes = parseCustomAttributes(match[2] ?? "");
  return attributes ? { name, attributes } : undefined;
}

/**
 * `{key=value key="value with spaces"}` 形式の属性を解析する。値は常に文字列
 * (真偽値・数値型は持たない)。トークン化できない箇所があれば undefined を返し、
 * 呼び出し元はdirective行ごと原文へ差し戻す(壊れた属性の素通し契約)。
 */
function parseCustomAttributes(raw: string): Record<string, string> | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return {};

  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w-]*)=(?:"([^"]*)"|(\S+))/uy;
  let cursor = 0;

  while (cursor < trimmed.length) {
    while (cursor < trimmed.length && /\s/u.test(trimmed[cursor])) cursor += 1;
    if (cursor >= trimmed.length) break;

    pattern.lastIndex = cursor;
    const match = pattern.exec(trimmed);
    if (!match) return undefined;
    attributes[match[1]] = match[2] ?? match[3] ?? "";
    cursor = pattern.lastIndex;
  }

  return attributes;
}

function readClosing(line: string): 3 | 4 | undefined {
  const match = line.match(/^(:{3,4})[ \t]*$/u);
  return match ? (match[1].length as 3 | 4) : undefined;
}

function updateFence(activeFence: string | undefined, line: string): string | undefined {
  const match = line.match(activeFence ? FENCE_CLOSE : FENCE_START);
  if (!match) return activeFence;
  const marker = match[2];
  if (!activeFence) return marker;
  return marker[0] === activeFence[0] && marker.length >= activeFence.length ? undefined : activeFence;
}

function isSpeechDirective(name: MarkdownDirectiveName): name is "speech-left" | "speech-right" {
  return name === "speech-left" || name === "speech-right";
}
