import { CODE_LINE_TURN_ICONS } from "./code-line-contract";
import type { Element } from "hast";
import type { TurnCalloutIcon } from "./annotations";

/** Iconify Heroiconsを、HTML文字列を経由しない安全なSVG HASTとして返す。 */
export function createLineCalloutIcon(icon: TurnCalloutIcon): Element {
  const spec = CODE_LINE_TURN_ICONS[icon];
  return {
    type: "element",
    tagName: "svg",
    properties: {
      "aria-hidden": "true",
      "data-icon": spec.dataIcon,
      viewBox: spec.viewBox,
    },
    children: [{ type: "element", tagName: "path", properties: spec.path, children: [] }],
  };
}
