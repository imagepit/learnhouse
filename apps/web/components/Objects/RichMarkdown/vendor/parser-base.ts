import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { annotateStandaloneLinkCards } from "./link-card";

const markdownParser = unified().use(remarkParse).use(remarkGfm).freeze();

/** The plain CommonMark + GFM parser used for every non-directive source segment. */
export function parseMarkdownBase(markdown: string): Root {
  return annotateStandaloneLinkCards(markdownParser.parse(markdown) as Root, markdown);
}
