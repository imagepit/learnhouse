import type { ListItem, PhrasingContent } from "mdast";
import type { MarkdownRootContent } from "./directives";

export const STEP_DIVIDER_COMMENT = "<!--divider-->";

export interface MarkdownStep {
  body: MarkdownRootContent[];
  title: PhrasingContent[];
}

export interface MarkdownStepsCollection {
  /** 最初のordered listより前に書かれた説明・画像。Stepsの直前に元の順序で表示する。 */
  leading: MarkdownRootContent[];
  steps: MarkdownStep[];
}

export interface MarkdownStepBody<TNode> {
  aside: TNode[] | undefined;
  main: TNode[];
}

export interface MarkdownStepBodyNode {
  type: string;
  value?: unknown;
}

/** Step本文内で単独行として解析された、媒体共通の2カラム区切り。 */
export function isMarkdownStepDivider(node: MarkdownStepBodyNode): boolean {
  return node.type === "html" && typeof node.value === "string" && node.value.trim() === STEP_DIVIDER_COMMENT;
}

/**
 * Step本文を左本文と右補足へ分ける。区切りが1個で両側に表示内容がある場合だけ成立する。
 * 不成立時も区切りコメントは除去し、残りの本文順序を変えずに1カラムへ戻す。
 */
export function splitMarkdownStepBody<TNode extends MarkdownStepBodyNode>(body: readonly TNode[]): MarkdownStepBody<TNode> {
  const dividerIndexes: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    if (isMarkdownStepDivider(body[index])) dividerIndexes.push(index);
  }

  const withoutDividers = body.filter((node) => !isMarkdownStepDivider(node));
  if (dividerIndexes.length !== 1) return { main: withoutDividers, aside: undefined };

  const dividerIndex = dividerIndexes[0];
  const main = body.slice(0, dividerIndex).filter((node) => !isMarkdownStepDivider(node));
  const aside = body.slice(dividerIndex + 1).filter((node) => !isMarkdownStepDivider(node));
  if (!hasRenderableStepContent(main) || !hasRenderableStepContent(aside)) {
    return { main: withoutDividers, aside: undefined };
  }

  return { main, aside };
}

/** `:::step`直下の一次ordered listを媒体非依存のStep意味構造へ正規化する。 */
export function collectMarkdownSteps(nodes: readonly MarkdownRootContent[]): MarkdownStepsCollection {
  const leading: MarkdownRootContent[] = [];
  const steps: MarkdownStep[] = [];
  let lastStep: MarkdownStep | undefined;

  for (const node of nodes) {
    if (node.type === "list" && node.ordered) {
      for (const item of node.children) {
        const step = createMarkdownStep(item);
        steps.push(step);
        lastStep = step;
      }
      continue;
    }

    if (lastStep) {
      lastStep.body.push(node);
    } else {
      leading.push(node);
    }
  }

  // 既存教材にはordered listを持たず、先頭の強調段落を単一手順名として使う
  // `:::step`がある。旧.step boxへ戻さず、共有Step 1件へ正規化して表示を維持する。
  if (steps.length === 0) {
    const legacyTitle = readStandaloneStrongTitle(leading[0]);
    if (legacyTitle) {
      return {
        leading: [],
        steps: [{ title: legacyTitle, body: leading.slice(1) }],
      };
    }
  }

  return { leading, steps };
}

function createMarkdownStep(item: ListItem): MarkdownStep {
  const [first, ...body] = item.children;
  if (first?.type !== "paragraph") {
    return { body: item.children as MarkdownRootContent[], title: [] };
  }

  return {
    body: body as MarkdownRootContent[],
    title: first.children,
  };
}

function readStandaloneStrongTitle(node: MarkdownRootContent | undefined): PhrasingContent[] | undefined {
  if (node?.type !== "paragraph" || node.children.length !== 1) return undefined;
  const child = node.children[0];
  return child.type === "strong" ? child.children : undefined;
}

function hasRenderableStepContent(nodes: readonly MarkdownStepBodyNode[]): boolean {
  return nodes.some((node) => {
    if (node.type !== "html" || typeof node.value !== "string") return true;
    return !/^(?:\s*<!--[\s\S]*?-->\s*)+$/u.test(node.value);
  });
}
