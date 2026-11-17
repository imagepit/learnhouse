import type { Link, Paragraph, Root, RootContent } from "mdast";

declare module "mdast" {
  interface ParagraphData {
    imagepitXStatus?: MarkdownXStatusReference;
    imagepitLinkCard?: true;
  }
}

export interface MarkdownLinkCardData {
  imagepitLinkCard?: true;
  imagepitXStatus?: MarkdownXStatusReference;
}

export interface MarkdownXStatusReference {
  statusId: string;
  url: string;
  username?: string;
}

/** Mark only source-exact, standalone raw http(s) autolinks for LinkCard rendering. */
export function annotateStandaloneLinkCards(root: Root, source: string): Root {
  for (const node of root.children) annotateNode(node, source);
  return root;
}

export function isStandaloneLinkCard(node: RootContent): node is Paragraph & { data: MarkdownLinkCardData } {
  return node.type === "paragraph" && (node.data as MarkdownLinkCardData | undefined)?.imagepitLinkCard === true;
}

export function readStandaloneXStatus(node: RootContent): MarkdownXStatusReference | undefined {
  return node.type === "paragraph" ? (node.data as MarkdownLinkCardData | undefined)?.imagepitXStatus : undefined;
}

function annotateNode(node: RootContent, source: string): void {
  if (node.type === "paragraph") {
    const url = rawStandaloneHttpUrl(node, source);
    if (url) {
      const xStatus = parseXStatusUrl(url);
      if (xStatus) {
        node.data = { ...node.data, imagepitXStatus: xStatus };
      } else if (!isXStatusLikeUrl(url)) {
        node.data = { ...node.data, imagepitLinkCard: true };
      }
      return;
    }
  }

  if ("children" in node) {
    for (const child of node.children) {
      if ("type" in child && isRootContent(child)) annotateNode(child, source);
    }
  }
}

function isXStatusLikeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const xOwnedHost = hostname === "x.com" || hostname.endsWith(".x.com") ||
      hostname === "twitter.com" || hostname.endsWith(".twitter.com");
    return xOwnedHost && /^\/[^/]+(?:\/web)?\/status\/[^/]+(?:\/|$)/u.test(url.pathname);
  } catch {
    return false;
  }
}

/** Parse only supported X/Twitter status URLs and return a query-free canonical reference. */
export function parseXStatusUrl(value: string): MarkdownXStatusReference | undefined {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const allowedHost = hostname === "x.com" || hostname === "www.x.com" || hostname === "twitter.com" ||
      hostname === "www.twitter.com" || hostname === "mobile.twitter.com";
    if (!allowedHost || (url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return undefined;
    }

    const userStatus = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,40})(?:\/(?:photo|video)\/\d+)?\/?$/u.exec(url.pathname);
    const webStatus = /^\/i\/web\/status\/(\d{1,40})(?:\/(?:photo|video)\/\d+)?\/?$/u.exec(url.pathname);
    if (userStatus) {
      const username = userStatus[1];
      const statusId = userStatus[2];
      return { statusId, username, url: `https://x.com/${username}/status/${statusId}` };
    }
    if (webStatus) {
      const statusId = webStatus[1];
      return { statusId, url: `https://x.com/i/web/status/${statusId}` };
    }
    return;
  } catch {
    return undefined;
  }
}

function isRootContent(node: unknown): node is RootContent {
  return Boolean(node && typeof node === "object" && "type" in node);
}

function rawStandaloneHttpUrl(node: Paragraph, source: string): string | undefined {
  if (node.children.length !== 1 || node.children[0]?.type !== "link") return undefined;
  const link = node.children[0] as Link;
  if (!isHttpUrl(link.url)) return undefined;
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return undefined;

  // Compare the original source range, rather than the MDAST shape alone, so explicit
  // Markdown links and prose autolinks can never be mistaken for LinkCard syntax.
  const raw = source.slice(start, end).trim();
  return raw === link.url || raw === `<${link.url}>` ? link.url : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}
