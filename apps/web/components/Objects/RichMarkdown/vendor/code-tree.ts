import type { Code } from "mdast";
import { parseMarkdownBase } from "./parser-base";

export interface CodeTreeContainerMeta {
  title?: string;
  height?: string;
  entry?: string;
}

export interface ParsedCodeTreeFile {
  path: string;
  language: string;
  code: string;
}

export interface ParsedCodeTree {
  files: readonly ParsedCodeTreeFile[];
  initialPath: string;
  title?: string;
  height?: string;
}

interface CodeTreeFenceMeta {
  path: string;
  active: boolean;
}

const CSS_LENGTH_UNITS = [
  "px", "cm", "mm", "Q", "in", "pc", "pt",
  "em", "rem", "ex", "rex", "ch", "rch", "cap", "rcap", "ic", "ric", "lh", "rlh",
  "vw", "vh", "vi", "vb", "vmin", "vmax",
  "svw", "svh", "svi", "svb", "svmin", "svmax",
  "lvw", "lvh", "lvi", "lvb", "lvmin", "lvmax",
  "dvw", "dvh", "dvi", "dvb", "dvmin", "dvmax",
] as const;
const CSS_LENGTH_RE = new RegExp(
  `^(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:${CSS_LENGTH_UNITS.join("|")})$`,
  "u",
);

/** CodeTreeのcontainer属性とcode fenceだけを厳格に正規化する。 */
export function parseCodeTree(source: string, rawAttributes = ""): ParsedCodeTree | undefined {
  const meta = parseCodeTreeContainerMeta(rawAttributes);
  if (!meta) return undefined;

  const root = parseMarkdownBase(source);
  if (root.children.length === 0 || !root.children.every((node): node is Code => node.type === "code")) {
    return undefined;
  }

  const files: ParsedCodeTreeFile[] = [];
  const activePaths: string[] = [];
  for (const node of root.children) {
    const language = node.lang?.trim();
    const fenceMeta = parseCodeTreeFenceMeta(node.meta);
    if (!language || !fenceMeta) return undefined;
    files.push({ path: fenceMeta.path, language, code: node.value });
    if (fenceMeta.active) activePaths.push(fenceMeta.path);
  }

  if (!hasUniqueNonConflictingPaths(files.map((file) => file.path))) return undefined;
  if (activePaths.length > 1) return undefined;
  if (meta.entry && !files.some((file) => file.path === meta.entry)) return undefined;

  return {
    files,
    initialPath: meta.entry ?? activePaths[0] ?? files[0].path,
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.height ? { height: meta.height } : {}),
  };
}

/** `title`・安全なCSS lengthの`height`・相対POSIX pathの`entry`だけを受理する。 */
export function parseCodeTreeContainerMeta(raw: string | null | undefined): CodeTreeContainerMeta | undefined {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return {};

  const result: CodeTreeContainerMeta = {};
  const seen = new Set<string>();
  const pattern = /(title|height|entry)="([^"]*)"/uy;
  let cursor = 0;
  while (cursor < trimmed.length) {
    while (cursor < trimmed.length && /\s/u.test(trimmed[cursor])) cursor += 1;
    pattern.lastIndex = cursor;
    const match = pattern.exec(trimmed);
    if (!match || seen.has(match[1])) return undefined;
    seen.add(match[1]);

    const [, name, value] = match;
    if (name === "title") {
      if (value) result.title = value;
    } else if (name === "height") {
      if (!CSS_LENGTH_RE.test(value)) return undefined;
      result.height = value;
    } else {
      if (!isRelativePosixPath(value)) return undefined;
      result.entry = value;
    }
    cursor = pattern.lastIndex;
  }
  return result;
}

function parseCodeTreeFenceMeta(raw: string | null | undefined): CodeTreeFenceMeta | undefined {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return undefined;

  let active = false;
  let path: string | undefined;
  const pattern = /(?:title="([^"]*)"|(:active))/uy;
  let cursor = 0;
  while (cursor < trimmed.length) {
    while (cursor < trimmed.length && /\s/u.test(trimmed[cursor])) cursor += 1;
    pattern.lastIndex = cursor;
    const match = pattern.exec(trimmed);
    if (!match) return undefined;
    if (match[2]) {
      if (active) return undefined;
      active = true;
    } else {
      if (path !== undefined || !isRelativePosixPath(match[1])) return undefined;
      path = match[1];
    }
    cursor = pattern.lastIndex;
  }

  return path ? { path, active } : undefined;
}

function isRelativePosixPath(value: string): boolean {
  if (!value || value !== value.trim() || value.startsWith("/") || value.endsWith("/") || value.includes("\\")) {
    return false;
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function hasUniqueNonConflictingPaths(paths: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) return false;
    for (const other of seen) {
      if (path.startsWith(`${other}/`) || other.startsWith(`${path}/`)) return false;
    }
    seen.add(path);
  }
  return true;
}
