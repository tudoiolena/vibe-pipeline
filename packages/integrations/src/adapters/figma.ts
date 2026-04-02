import { DesignMapSchema, DesignNodeSchema, type DesignMap } from "@vibe/schema";
import { z } from "zod";

type DesignNode = z.infer<typeof DesignNodeSchema>;
import { requireFigmaAccessToken } from "../env";

const FIGMA_API_BASE = "https://api.figma.com/v1";

/** Pipeline tracing — filter logs with `[figma]` */
function figmaTrace(step: string, detail?: Record<string, unknown>): void {
  if (detail !== undefined) {
    console.log(`[figma] ${step}`, detail);
  } else {
    console.log(`[figma] ${step}`);
  }
}

function countCanvasPages(document: FigmaFileNode): number {
  return (document.children ?? []).filter((c) => c.type === "CANVAS").length;
}

/** Minimal Figma file node (GET /v1/files/:key document subtree). */
export type FigmaFileNode = {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaFileNode[];
};

export type FigmaFileResponse = {
  name: string;
  document: FigmaFileNode;
};

export type FigmaFileStyle = {
  key?: string;
  nodeId?: string;
  styleType?: string;
  name: string;
  description?: string;
  hex?: string;
  rawPayload: Record<string, unknown>;
};

export type FigmaFileComponent = {
  key?: string;
  nodeId?: string;
  name: string;
  description?: string;
  rawPayload: Record<string, unknown>;
};

export type FigmaFileMetadata = {
  fileKey: string;
  fileName: string;
  document: FigmaFileNode;
  styles: FigmaFileStyle[];
  components: FigmaFileComponent[];
  frameAnalysis: {
    commonCornerRadii: number[];
    shadowEffects: string[];
    commonItemSpacing: number[];
    commonMaxWidths: number[];
  };
  /** How the UI Kit page was chosen and loaded (REST shallow file + nodes ≈ MCP discovery + deep tree). */
  uiKitExtraction?: {
    targetedPageName: string;
    selectionReason: string;
    readMethod: string;
  };
};

export type FigmaClient = {
  getFile: (fileKey: string, options?: { depth?: number }) => Promise<FigmaFileResponse>;
  getFileNode: (fileKey: string, nodeId: string) => Promise<FigmaFileNode | null>;
  getFileStyles: (fileKey: string) => Promise<{ styles: FigmaFileStyle[]; components: FigmaFileComponent[] }>;
};

function buildFigmaDesignUrl(fileKey: string, fileName: string, nodeId: string): string {
  const nodeParam = nodeId.replace(/:/g, "-");
  const titleSegment = encodeURIComponent(fileName.trim() || "file");
  return `https://www.figma.com/design/${encodeURIComponent(fileKey)}/${titleSegment}?node-id=${encodeURIComponent(nodeParam)}`;
}

function isCanvas(node: FigmaFileNode): boolean {
  return node.type === "CANVAS";
}

export type FigmaUiKitTargetPage = {
  pageId: string;
  pageName: string;
  selectionReason: string;
};

/**
 * Picks the canvas used for UI Kit extraction (spec FR-002 / FR-003): UI Kit / Design System / Styles / Tokens,
 * then Main, then Desktop, else first page.
 */
export function resolveFigmaUiKitTargetPage(document: FigmaFileNode): FigmaUiKitTargetPage {
  const pages = (document.children ?? []).filter((child) => child.type === "CANVAS");
  figmaTrace("resolveFigmaUiKitTargetPage: canvas count", { canvasCount: pages.length, pageNames: pages.map((p) => p.name) });
  if (pages.length === 0) {
    figmaTrace("resolveFigmaUiKitTargetPage: no pages", { selectionReason: "no-canvas-pages" });
    return { pageId: "", pageName: "", selectionReason: "no-canvas-pages" };
  }
  const kitPattern = /(ui\s*kit|design\s*system|styles|tokens)/i;
  for (const page of pages) {
    if (kitPattern.test(page.name)) {
      const out = { pageId: page.id, pageName: page.name, selectionReason: "matched-ui-kit-or-design-system" as const };
      figmaTrace("resolveFigmaUiKitTargetPage: selected", out);
      return out;
    }
  }
  for (const candidate of ["Main", "Desktop"] as const) {
    const found = pages.find((p) => p.name.trim().toLowerCase() === candidate.toLowerCase());
    if (found) {
      const out = { pageId: found.id, pageName: found.name, selectionReason: `fallback-page-${candidate.toLowerCase()}` as const };
      figmaTrace("resolveFigmaUiKitTargetPage: selected", out);
      return out;
    }
  }
  const first = pages[0]!;
  const out = { pageId: first.id, pageName: first.name, selectionReason: "fallback-first-canvas" as const };
  figmaTrace("resolveFigmaUiKitTargetPage: selected", out);
  return out;
}

/** Extract Figma file key from a design URL (uses branch key when URL contains `/branch/:branchKey/`, per Figma MCP rules). */
export function extractFigmaFileKeyFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    figmaTrace("extractFigmaFileKeyFromUrl: empty input", {});
    return null;
  }
  const branchMatch = trimmed.match(/figma\.com\/design\/[A-Za-z0-9]+\/branch\/([A-Za-z0-9]+)/i);
  if (branchMatch?.[1]) {
    figmaTrace("extractFigmaFileKeyFromUrl: branch key", { fileKey: branchMatch[1], urlPreview: trimmed.slice(0, 120) });
    return branchMatch[1];
  }
  const match = trimmed.match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]+)(?:\/|$|[?#])/i);
  const key = match?.[1] ?? null;
  figmaTrace("extractFigmaFileKeyFromUrl: result", { fileKey: key, urlPreview: trimmed.slice(0, 120) });
  return key;
}

/**
 * Verifies the file is readable with shallow depth (same discovery surface as MCP `get_metadata` overview).
 * Used by the pipeline before treating Figma as design truth.
 */
export async function verifyFigmaDesignAccessible(fileKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const key = fileKey.trim();
    figmaTrace("verifyFigmaDesignAccessible: start", { fileKey: key || "(empty)" });
    if (!key) {
      figmaTrace("verifyFigmaDesignAccessible: failed", { reason: "empty-key" });
      return { ok: false, error: "Empty Figma file key." };
    }
    const client = createFigmaClient();
    const file = await client.getFile(key, { depth: 1 });
    figmaTrace("verifyFigmaDesignAccessible: success", {
      fileName: file.name,
      canvasCount: countCanvasPages(file.document),
      topLevelChildTypes: (file.document.children ?? []).slice(0, 12).map((c) => c.type)
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    figmaTrace("verifyFigmaDesignAccessible: error", { error: message });
    return { ok: false, error: message };
  }
}

function collectTopLevelFrames(canvas: FigmaFileNode, fileKey: string, fileName: string): DesignNode[] {
  const out: DesignNode[] = [];
  for (const child of canvas.children ?? []) {
    if (child.type !== "FRAME") {
      continue;
    }
    out.push({
      figmaFileKey: fileKey,
      nodeId: child.id,
      nodeType: "screen",
      nodeName: child.name,
      figmaUrl: buildFigmaDesignUrl(fileKey, fileName, child.id),
      rawPayload: { figmaType: child.type, pageName: canvas.name }
    });
  }
  return out;
}

function collectComponentNodes(
  node: FigmaFileNode,
  fileKey: string,
  fileName: string,
  into: DesignNode[],
  parentIsComponentSet: boolean
): void {
  if (node.type === "COMPONENT" && !parentIsComponentSet) {
    into.push({
      figmaFileKey: fileKey,
      nodeId: node.id,
      nodeType: "component",
      nodeName: node.name,
      figmaUrl: buildFigmaDesignUrl(fileKey, fileName, node.id),
      rawPayload: { figmaType: node.type }
    });
  } else if (node.type === "COMPONENT_SET") {
    into.push({
      figmaFileKey: fileKey,
      nodeId: node.id,
      nodeType: "component",
      nodeName: node.name,
      figmaUrl: buildFigmaDesignUrl(fileKey, fileName, node.id),
      rawPayload: { figmaType: node.type }
    });
    for (const child of node.children ?? []) {
      if (child.type === "COMPONENT") {
        into.push({
          figmaFileKey: fileKey,
          nodeId: child.id,
          nodeType: "variant",
          nodeName: child.name,
          figmaUrl: buildFigmaDesignUrl(fileKey, fileName, child.id),
          rawPayload: { figmaType: child.type, componentSetId: node.id, componentSetName: node.name }
        });
      }
    }
    for (const child of node.children ?? []) {
      if (child.type !== "COMPONENT") {
        collectComponentNodes(child, fileKey, fileName, into, false);
      }
    }
    return;
  }

  const nextParentSet = node.type === "COMPONENT_SET";
  for (const child of node.children ?? []) {
    collectComponentNodes(child, fileKey, fileName, into, nextParentSet);
  }
}

/**
 * Maps a Figma file document tree into {@link DesignMapSchema} nodes.
 * - Screens: FRAME nodes that are direct children of a CANVAS (page).
 * - Components: COMPONENT nodes; COMPONENT_SET as component with VARIANT children as `variant` nodes.
 */
export function mapFigmaFileToDesignMap(metadata: FigmaFileMetadata): DesignMap {
  const { fileKey, fileName, document } = metadata;
  const nodes: DesignNode[] = [];

  for (const child of document.children ?? []) {
    if (isCanvas(child)) {
      nodes.push(...collectTopLevelFrames(child, fileKey, fileName));
    }
  }

  collectComponentNodes(document, fileKey, fileName, nodes, false);

  const byType = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.nodeType] = (acc[n.nodeType] ?? 0) + 1;
    return acc;
  }, {});
  figmaTrace("mapFigmaFileToDesignMap: built", {
    fileKey,
    fileName,
    totalNodes: nodes.length,
    byNodeType: byType
  });

  return DesignMapSchema.parse({
    nodes,
    links: []
  });
}

async function figmaFetchJson(path: string, token: string): Promise<unknown> {
  const url = `${FIGMA_API_BASE}${path}`;
  figmaTrace("API request", { path: path.split("?")[0], hasQuery: path.includes("?") });
  const response = await fetch(url, {
    headers: {
      "X-Figma-Token": token
    }
  });

  if (!response.ok) {
    const body = await response.text();
    figmaTrace("API error response", { status: response.status, statusText: response.statusText, bodyPreview: body.slice(0, 400) });
    throw new Error(`Figma API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
  }

  figmaTrace("API response OK", { path: path.split("?")[0], status: response.status });
  return response.json() as Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFigmaFileResponse(raw: unknown): FigmaFileResponse {
  if (!isRecord(raw) || typeof raw.name !== "string" || !isRecord(raw.document)) {
    throw new Error("Figma file response is missing name or document.");
  }
  return {
    name: raw.name,
    document: raw.document as FigmaFileNode
  };
}

function optionalString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function toHexComponent(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0").toUpperCase();
}

export function figmaRgbToHex(color: Record<string, unknown>, alpha?: unknown): string | null {
  const r = color.r;
  const g = color.g;
  const b = color.b;
  if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") {
    return null;
  }
  const rr = toHexComponent(r <= 1 ? r * 255 : r);
  const gg = toHexComponent(g <= 1 ? g * 255 : g);
  const bb = toHexComponent(b <= 1 ? b * 255 : b);
  const hasAlpha = typeof alpha === "number" && alpha >= 0 && alpha < 1;
  if (!hasAlpha) {
    return `#${rr}${gg}${bb}`;
  }
  const aa = toHexComponent((alpha as number) * 255);
  return `#${rr}${gg}${bb}${aa}`;
}

function parseHexCandidate(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
  if (!match) {
    return null;
  }
  return trimmed.startsWith("#") ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pushCount(map: Map<number, number>, value: number | null): void {
  if (value === null) {
    return;
  }
  const normalized = Math.round(value * 100) / 100;
  map.set(normalized, (map.get(normalized) ?? 0) + 1);
}

function topValuesByCount(map: Map<number, number>, limit = 3): number[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([value]) => value);
}

function toAlphaRounded(value: number): string {
  return `${Math.round(value * 1000) / 1000}`;
}

function figmaShadowToTailwind(effect: Record<string, unknown>): string | null {
  const effectType = optionalString(effect, "type");
  if (effectType !== "DROP_SHADOW") {
    return null;
  }
  const offset = isRecord(effect.offset) ? effect.offset : null;
  const radius = readNumber(effect, "radius") ?? 0;
  const spread = readNumber(effect, "spread") ?? 0;
  const x = (offset && readNumber(offset, "x")) ?? 0;
  const y = (offset && readNumber(offset, "y")) ?? 0;
  const colorRecord = isRecord(effect.color) ? effect.color : null;
  const colorHex = colorRecord ? figmaRgbToHex(colorRecord, colorRecord.a ?? effect.opacity) : null;
  if (!colorHex) {
    return null;
  }
  if (colorHex.length === 9) {
    const rgb = colorHex.slice(1, 7);
    const alphaHex = colorHex.slice(7, 9);
    const alpha = parseInt(alphaHex, 16) / 255;
    const r = parseInt(rgb.slice(0, 2), 16);
    const g = parseInt(rgb.slice(2, 4), 16);
    const b = parseInt(rgb.slice(4, 6), 16);
    return `${x}px ${y}px ${radius}px ${spread}px rgb(${r} ${g} ${b} / ${toAlphaRounded(alpha)})`;
  }
  return `${x}px ${y}px ${radius}px ${spread}px ${colorHex}`;
}

function analyzeFrameTokens(document: FigmaFileNode): FigmaFileMetadata["frameAnalysis"] {
  const radiusCounts = new Map<number, number>();
  const spacingCounts = new Map<number, number>();
  const maxWidthCounts = new Map<number, number>();
  const shadowSet = new Set<string>();

  const walk = (node: FigmaFileNode): void => {
    const nodeRecord = node as unknown as Record<string, unknown>;
    if (node.type === "FRAME") {
      pushCount(radiusCounts, readNumber(nodeRecord, "cornerRadius"));
      pushCount(spacingCounts, readNumber(nodeRecord, "itemSpacing"));
      pushCount(maxWidthCounts, readNumber(nodeRecord, "maxWidth"));

      const absoluteBoundingBox = isRecord(nodeRecord.absoluteBoundingBox) ? nodeRecord.absoluteBoundingBox : null;
      pushCount(maxWidthCounts, absoluteBoundingBox ? readNumber(absoluteBoundingBox, "width") : null);

      const effects = Array.isArray(nodeRecord.effects) ? nodeRecord.effects : [];
      for (const effect of effects) {
        if (!isRecord(effect)) {
          continue;
        }
        const shadow = figmaShadowToTailwind(effect);
        if (shadow) {
          shadowSet.add(shadow);
        }
      }
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };

  walk(document);
  return {
    commonCornerRadii: topValuesByCount(radiusCounts),
    shadowEffects: Array.from(shadowSet),
    commonItemSpacing: topValuesByCount(spacingCounts),
    commonMaxWidths: topValuesByCount(maxWidthCounts)
  };
}

function extractHexFromUnknown(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return parseHexCandidate(value) ?? undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const directHex = optionalString(value, "hex", "color", "value");
  const parsedDirectHex = directHex ? parseHexCandidate(directHex) : null;
  if (parsedDirectHex) {
    return parsedDirectHex;
  }

  const normalizedColor = isRecord(value.color) ? figmaRgbToHex(value.color, value.opacity) : null;
  if (normalizedColor) {
    return normalizedColor;
  }

  const paints = Array.isArray(value.paints) ? value.paints : Array.isArray(value.fills) ? value.fills : [];
  for (const paint of paints) {
    if (!isRecord(paint)) {
      continue;
    }
    const color = isRecord(paint.color) ? figmaRgbToHex(paint.color, paint.opacity) : null;
    if (color) {
      return color;
    }
  }

  return undefined;
}

function parseFigmaStylesResponse(raw: unknown): { styles: FigmaFileStyle[]; components: FigmaFileComponent[] } {
  if (!isRecord(raw)) {
    return { styles: [], components: [] };
  }

  const containers: Record<string, unknown>[] = [
    raw,
    ...(isRecord(raw.meta) ? [raw.meta] : []),
    ...(isRecord(raw.data) ? [raw.data] : [])
  ];

  const parsedStyles: FigmaFileStyle[] = [];
  const parsedComponents: FigmaFileComponent[] = [];

  for (const container of containers) {
    const styleCandidates = Array.isArray(container.styles)
      ? container.styles
      : isRecord(container.styles)
        ? Object.values(container.styles)
        : [];

    for (const style of styleCandidates) {
      if (!isRecord(style)) {
        continue;
      }
      const name = optionalString(style, "name");
      if (!name) {
        continue;
      }
      parsedStyles.push({
        key: optionalString(style, "key", "style_key"),
        nodeId: optionalString(style, "node_id", "nodeId"),
        styleType: optionalString(style, "style_type", "styleType"),
        name,
        description: optionalString(style, "description"),
        hex: extractHexFromUnknown(style),
        rawPayload: style
      });
    }

    const componentCandidates = Array.isArray(container.components)
      ? container.components
      : isRecord(container.components)
        ? Object.values(container.components)
        : [];

    for (const component of componentCandidates) {
      if (!isRecord(component)) {
        continue;
      }
      const name = optionalString(component, "name");
      if (!name) {
        continue;
      }
      parsedComponents.push({
        key: optionalString(component, "key"),
        nodeId: optionalString(component, "node_id", "nodeId"),
        name,
        description: optionalString(component, "description"),
        rawPayload: component
      });
    }
  }

  const dedupe = <T extends { key?: string; nodeId?: string; name: string }>(items: T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
      const dedupeKey = `${item.key ?? ""}|${item.nodeId ?? ""}|${item.name}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      out.push(item);
    }
    return out;
  };

  return {
    styles: dedupe(parsedStyles),
    components: dedupe(parsedComponents)
  };
}

/**
 * Figma REST client. {@link requireFigmaAccessToken} runs before network calls.
 */
export function createFigmaClient(): FigmaClient {
  return {
    async getFile(fileKey: string, options?: { depth?: number }): Promise<FigmaFileResponse> {
      const token = requireFigmaAccessToken();
      const key = fileKey.trim();
      if (!key) {
        throw new Error("Figma file key cannot be empty.");
      }
      const depth =
        typeof options?.depth === "number" && Number.isFinite(options.depth) && options.depth > 0 ? Math.floor(options.depth) : undefined;
      figmaTrace("getFile: start", { fileKey: key, depth: depth ?? "full (no depth param)" });
      const query = new URLSearchParams({ geometry: "omit" });
      if (depth !== undefined) {
        query.set("depth", `${depth}`);
      }
      const raw = await figmaFetchJson(`/files/${encodeURIComponent(key)}?${query}`, token);
      const parsed = parseFigmaFileResponse(raw);
      const rootChildren = parsed.document.children ?? [];
      figmaTrace("getFile: parsed", {
        fileKey: key,
        fileName: parsed.name,
        depth: depth ?? "full",
        rootChildCount: rootChildren.length,
        canvasCount: countCanvasPages(parsed.document),
        sampleRootTypes: rootChildren.slice(0, 8).map((c) => `${c.type}:${c.name?.slice(0, 40) ?? ""}`)
      });
      return parsed;
    },
    async getFileNode(fileKey: string, nodeId: string): Promise<FigmaFileNode | null> {
      const token = requireFigmaAccessToken();
      const key = fileKey.trim();
      const id = nodeId.trim();
      if (!key || !id) {
        throw new Error("Figma file key and node id cannot be empty.");
      }
      figmaTrace("getFileNode: start", { fileKey: key, nodeId: id });
      const query = new URLSearchParams({ ids: id, geometry: "omit" });
      const raw = await figmaFetchJson(`/files/${encodeURIComponent(key)}/nodes?${query}`, token);
      if (!isRecord(raw) || !isRecord(raw.nodes)) {
        figmaTrace("getFileNode: missing nodes map in response", { fileKey: key, nodeId: id });
        return null;
      }
      const nodeIdsInResponse = Object.keys(raw.nodes);
      const nodeEntry = raw.nodes[id];
      if (!isRecord(nodeEntry) || !isRecord(nodeEntry.document)) {
        figmaTrace("getFileNode: no document for id", { fileKey: key, nodeId: id, nodeIdsInResponse });
        return null;
      }
      const doc = nodeEntry.document as FigmaFileNode;
      figmaTrace("getFileNode: loaded subtree", {
        fileKey: key,
        nodeId: id,
        rootName: doc.name,
        rootType: doc.type,
        childCount: doc.children?.length ?? 0
      });
      return doc;
    },
    async getFileStyles(fileKey: string): Promise<{ styles: FigmaFileStyle[]; components: FigmaFileComponent[] }> {
      const token = requireFigmaAccessToken();
      const key = fileKey.trim();
      if (!key) {
        throw new Error("Figma file key cannot be empty.");
      }
      figmaTrace("getFileStyles: start", { fileKey: key });
      const raw = await figmaFetchJson(`/files/${encodeURIComponent(key)}/styles`, token);
      const parsed = parseFigmaStylesResponse(raw);
      const styleSample = parsed.styles.slice(0, 5).map((s) => ({ name: s.name, styleType: s.styleType, hex: s.hex }));
      const componentSample = parsed.components.slice(0, 5).map((c) => ({ name: c.name }));
      figmaTrace("getFileStyles: parsed", {
        fileKey: key,
        styleCount: parsed.styles.length,
        componentCount: parsed.components.length,
        styleSample,
        componentSample
      });
      return parsed;
    }
  };
}

/**
 * Fetches file metadata: file name plus the document tree (pages, top-level frames, components).
 * Uses `geometry=omit` to avoid heavy vector data.
 */
export async function getFigmaFileMetadata(fileKey: string): Promise<FigmaFileMetadata> {
  const trimmedKey = fileKey.trim();
  figmaTrace("getFigmaFileMetadata: start", { fileKey: trimmedKey });
  requireFigmaAccessToken();
  const client = createFigmaClient();
  figmaTrace("getFigmaFileMetadata: parallel shallow file + styles", { fileKey: trimmedKey });
  const [shallowFile, styleBundle] = await Promise.all([client.getFile(fileKey, { depth: 1 }), client.getFileStyles(fileKey)]);
  figmaTrace("getFigmaFileMetadata: shallow + styles done", {
    fileKey: trimmedKey,
    fileName: shallowFile.name,
    styleCount: styleBundle.styles.length,
    componentCount: styleBundle.components.length
  });
  const target = resolveFigmaUiKitTargetPage(shallowFile.document);
  const readMethod = "rest_deep_page_discovery";
  const deepPage = target.pageId ? await client.getFileNode(fileKey, target.pageId) : null;
  const resolvedDocument = deepPage ?? shallowFile.document;
  figmaTrace("getFigmaFileMetadata: document resolved", {
    fileKey: trimmedKey,
    usedDeepPage: Boolean(deepPage),
    resolvedRootType: resolvedDocument.type,
    resolvedRootName: resolvedDocument.name,
    resolvedChildCount: resolvedDocument.children?.length ?? 0
  });
  const frameAnalysis = analyzeFrameTokens(resolvedDocument);
  figmaTrace("getFigmaFileMetadata: frameAnalysis", {
    fileKey: trimmedKey,
    commonCornerRadii: frameAnalysis.commonCornerRadii,
    commonItemSpacing: frameAnalysis.commonItemSpacing,
    commonMaxWidths: frameAnalysis.commonMaxWidths,
    shadowEffectCount: frameAnalysis.shadowEffects.length
  });
  const uiKitExtraction =
    target.pageId && target.pageName
      ? {
          targetedPageName: target.pageName,
          selectionReason: target.selectionReason,
          readMethod
        }
      : undefined;
  const metadata: FigmaFileMetadata = {
    fileKey: trimmedKey,
    fileName: shallowFile.name,
    document: resolvedDocument,
    styles: styleBundle.styles,
    components: styleBundle.components,
    frameAnalysis,
    uiKitExtraction
  };
  figmaTrace("getFigmaFileMetadata: complete", {
    fileKey: trimmedKey,
    fileName: metadata.fileName,
    styles: metadata.styles.length,
    components: metadata.components.length,
    uiKitExtraction: metadata.uiKitExtraction ?? null
  });
  return metadata;
}
