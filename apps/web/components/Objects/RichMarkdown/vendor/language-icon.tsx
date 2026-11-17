import {
  Braces,
  Code,
  Ellipsis,
  File,
  FileCode,
  FileJson,
  FileTerminal,
  FileText,
  Folder,
  type LucideIcon,
} from "lucide-react";

// Generic file-type glyphs (not official per-language brand marks — trademark
// fidelity isn't attempted here) paired with a short label. Swap for real
// brand SVGs later if wanted; keep monochrome (currentColor) either way.
export interface LanguageMeta {
  Icon: LucideIcon;
  label: string;
}

const LANGUAGE_META: Record<string, LanguageMeta> = {
  ts: { Icon: FileCode, label: "TS" },
  typescript: { Icon: FileCode, label: "TS" },
  tsx: { Icon: FileCode, label: "TSX" },
  js: { Icon: FileCode, label: "JS" },
  javascript: { Icon: FileCode, label: "JS" },
  jsx: { Icon: FileCode, label: "JSX" },
  py: { Icon: FileCode, label: "PY" },
  python: { Icon: FileCode, label: "PY" },
  json: { Icon: FileJson, label: "JSON" },
  yaml: { Icon: FileCode, label: "YAML" },
  yml: { Icon: FileCode, label: "YAML" },
  md: { Icon: FileText, label: "MD" },
  markdown: { Icon: FileText, label: "MD" },
  html: { Icon: Code, label: "HTML" },
  css: { Icon: Braces, label: "CSS" },
  scss: { Icon: Braces, label: "SCSS" },
  sql: { Icon: Code, label: "SQL" },
  go: { Icon: Code, label: "GO" },
  rust: { Icon: Code, label: "RS" },
  rs: { Icon: Code, label: "RS" },
  bash: { Icon: FileTerminal, label: "SH" },
  sh: { Icon: FileTerminal, label: "SH" },
  shell: { Icon: FileTerminal, label: "SH" },
  zsh: { Icon: FileTerminal, label: "SH" },
};

export function getLanguageMeta(language?: string): LanguageMeta {
  const key = language?.trim().toLowerCase() ?? "";
  return Object.hasOwn(LANGUAGE_META, key) ? LANGUAGE_META[key] : { Icon: Code, label: language ? language.toUpperCase() : "CODE" };
}

export type FileTreeIconKind = "file" | "directory" | "placeholder";

export interface FileTreeIconMeta {
  Icon: LucideIcon;
  extension?: string;
}

/** File Treeが既存の言語glyph対応表を再利用するための解決helper。 */
export function getFileTreeIconMeta(name: string, kind: FileTreeIconKind): FileTreeIconMeta {
  if (kind === "directory") return { Icon: Folder };
  if (kind === "placeholder") return { Icon: Ellipsis };

  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : undefined;
  const { Icon } = extension ? getLanguageMeta(extension) : { Icon: File };
  return { Icon, ...(extension ? { extension } : {}) };
}
