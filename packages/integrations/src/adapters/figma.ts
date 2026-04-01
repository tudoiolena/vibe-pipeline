import { DesignMapSchema, DesignNodeSchema, type DesignMap } from "@vibe/schema";
import { z } from "zod";

type DesignNode = z.infer<typeof DesignNodeSchema>;
import { requireFigmaAccessToken } from "../env";

const FIGMA_API_BASE = "https://api.figma.com/v1";

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
};

export type FigmaClient = {
  getFile: (fileKey: string) => Promise<FigmaFileResponse>;
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

  return DesignMapSchema.parse({
    nodes,
    links: []
  });
}

async function figmaFetchJson(path: string, token: string): Promise<unknown> {
  const response = await fetch(`${FIGMA_API_BASE}${path}`, {
    headers: {
      "X-Figma-Token": token
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Figma API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
  }

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

function figmaRgbToHex(color: Record<string, unknown>, alpha?: unknown): string | null {
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
    async getFile(fileKey: string): Promise<FigmaFileResponse> {
      const token = requireFigmaAccessToken();
      const key = fileKey.trim();
      if (!key) {
        throw new Error("Figma file key cannot be empty.");
      }
      const query = new URLSearchParams({ geometry: "omit" });
      const raw = await figmaFetchJson(`/files/${encodeURIComponent(key)}?${query}`, token);
      return parseFigmaFileResponse(raw);
    },
    async getFileStyles(fileKey: string): Promise<{ styles: FigmaFileStyle[]; components: FigmaFileComponent[] }> {
      const token = requireFigmaAccessToken();
      const key = fileKey.trim();
      if (!key) {
        throw new Error("Figma file key cannot be empty.");
      }
      const raw = await figmaFetchJson(`/files/${encodeURIComponent(key)}/styles`, token);
      return parseFigmaStylesResponse(raw);
    }
  };
}

/**
 * Fetches file metadata: file name plus the document tree (pages, top-level frames, components).
 * Uses `geometry=omit` to avoid heavy vector data.
 */
export async function getFigmaFileMetadata(fileKey: string): Promise<FigmaFileMetadata> {
  requireFigmaAccessToken();
  const client = createFigmaClient();
  const [file, styleBundle] = await Promise.all([client.getFile(fileKey), client.getFileStyles(fileKey)]);
  return {
    fileKey: fileKey.trim(),
    fileName: file.name,
    document: file.document,
    styles: styleBundle.styles,
    components: styleBundle.components
  };
}
