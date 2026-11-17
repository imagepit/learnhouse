/** React・Markdown・Shiki・HASTに依存しないコード行DOM契約。 */
export const CODE_LINE_ANNOTATION_KINDS = ["add", "del", "highlight", "focus", "error", "warning"] as const;

export type CodeLineAnnotationKind = (typeof CODE_LINE_ANNOTATION_KINDS)[number];
export type CodeLineTurnPlacement = "before" | "after";
export type CodeLineTurnIcon = "heroicons:arrow-turn-left-down" | "heroicons:arrow-turn-left-up";

/** 行注釈ラベルを表示用の行へ分割する。空のsegmentも保持して改行位置を失わない。 */
export function splitCodeLineText(value: string): string[] {
  return value.split("\n");
}

/** 媒体固有nodeへ変換しつつ、明示改行を同じ順序で挟む。 */
export function mapCodeLineText<T>(
  value: string,
  createText: (segment: string, index: number) => T,
  createBreak: (index: number) => T,
): T[] {
  return splitCodeLineText(value).flatMap((segment, index) => index === 0
    ? [createText(segment, index)]
    : [createBreak(index), createText(segment, index)]);
}

export interface CodeLineEndCallout {
  indent?: string;
  label: string;
}

export interface CodeLineTurnCallout {
  indent?: string;
  label: string;
  placement: CodeLineTurnPlacement;
  icon?: CodeLineTurnIcon;
}

export interface CodeLineDescriptor<TContent = string> {
  content: TContent;
  annotationKinds: readonly CodeLineAnnotationKind[];
  endCallout?: CodeLineEndCallout;
  turnCallouts?: readonly CodeLineTurnCallout[];
  empty?: boolean;
}

export const CODE_LINE_CLASS = {
  root: "ui-code-lines",
  group: "code-line-group",
  line: "line",
  content: "code-line__content",
  prefix: "code-line__prefix",
  endCallout: "line-callout",
  endCalloutArrow: "line-callout__arrow",
  calloutLabel: "line-callout__label",
  turnCallout: "line-callout line-callout--turn",
  turnCalloutIndent: "line-callout__indent",
  turnCalloutIcon: "line-callout__icon",
} as const;

export const codeLineAnnotationClasses = (kinds: readonly CodeLineAnnotationKind[]) =>
  kinds.map((kind) => `line--${kind}`);

export const turnCalloutClasses = (
  placement: CodeLineTurnPlacement,
  kinds: readonly CodeLineAnnotationKind[],
) => [
  "line-callout",
  "line-callout--turn",
  `line-callout--${placement}`,
  ...kinds.map((kind) => `line-callout--${kind}`),
];

export interface CodeLineIconSpec {
  dataIcon: CodeLineTurnIcon;
  viewBox: "0 0 24 24";
  path: {
    fill: "none";
    stroke: "currentColor";
    strokeLinecap: "round";
    strokeLinejoin: "round";
    strokeWidth: "1.5";
    d: string;
  };
}

/** Heroicons outlineの正本。React/HAST双方がこの安全な属性specを直列化する。 */
export const CODE_LINE_TURN_ICONS: Record<CodeLineTurnIcon, CodeLineIconSpec> = {
  "heroicons:arrow-turn-left-down": {
    dataIcon: "heroicons:arrow-turn-left-down",
    viewBox: "0 0 24 24",
    path: { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "1.5", d: "m11.99 16.5l-3.75 3.75m0 0L4.49 16.5m3.75 3.75V3.75h11.25" },
  },
  "heroicons:arrow-turn-left-up": {
    dataIcon: "heroicons:arrow-turn-left-up",
    viewBox: "0 0 24 24",
    path: { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "1.5", d: "M11.99 7.5L8.24 3.75m0 0L4.49 7.5m3.75-3.75v16.499h11.25" },
  },
};

export const turnIconForPlacement = (placement: CodeLineTurnPlacement): CodeLineTurnIcon =>
  placement === "before" ? "heroicons:arrow-turn-left-down" : "heroicons:arrow-turn-left-up";
