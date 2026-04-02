/**
 * Figma UI Kit extraction for the LangGraph pipeline.
 *
 * Cursor’s Figma MCP exposes `get_metadata` / `get_design_context` / `get_variable_defs` (IDE-side). This package
 * uses the same design truth through {@link getFigmaFileMetadata} in `@vibe/integrations`: shallow `GET /v1/files/:key?depth=1`
 * for page discovery, then `GET /v1/files/:key/nodes?ids=` for the targeted page tree (MCP-equivalent discovery + deep nodes).
 */
import { z } from "zod";
import {
  getFigmaFileMetadata,
  type FigmaFileComponent,
  type FigmaFileMetadata,
  type FigmaFileNode,
  type FigmaFileStyle
} from "@vibe/integrations";
import { UIKitSchema } from "@vibe/schema";

export type UIKitParsed = z.infer<typeof UIKitSchema>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toHexComponent(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0").toUpperCase();
}

function rgbRecordToHex(color: Record<string, unknown>, alpha?: unknown): string | null {
  const { r, g, b } = color;
  if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") {
    return null;
  }
  const rr = toHexComponent(r <= 1 ? r * 255 : r);
  const gg = toHexComponent(g <= 1 ? g * 255 : g);
  const bb = toHexComponent(b <= 1 ? b * 255 : b);
  if (typeof alpha === "number" && alpha >= 0 && alpha < 1) {
    return `#${rr}${gg}${bb}${toHexComponent(alpha * 255)}`;
  }
  return `#${rr}${gg}${bb}`;
}

function extractColorsFromFills(fills: unknown[]): string | null {
  const solidFill = fills
    .map((fill) => asRecord(fill))
    .find((fill) => fill?.type === "SOLID" && fill.visible !== false);
  const fillColor = asRecord(solidFill?.color);
  if (!fillColor) {
    return null;
  }
  return rgbRecordToHex(fillColor, solidFill?.opacity);
}

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  if (!/^#?[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(trimmed)) {
    return null;
  }
  return trimmed.startsWith("#") ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
}

function parseHexRgb(hex: string): [number, number, number] | null {
  const n = normalizeHex(hex);
  if (!n || n.length < 7) {
    return null;
  }
  const r = Number.parseInt(n.slice(1, 3), 16);
  const g = Number.parseInt(n.slice(3, 5), 16);
  const b = Number.parseInt(n.slice(5, 7), 16);
  if ([r, g, b].some((x) => Number.isNaN(x))) {
    return null;
  }
  return [r, g, b];
}

function relativeLuminance(hex: string): number {
  const rgb = parseHexRgb(hex);
  if (!rgb) {
    return 0;
  }
  const lin = rgb.map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function saturation01(hex: string): number {
  const rgb = parseHexRgb(hex);
  if (!rgb) {
    return 0;
  }
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) {
    return 0;
  }
  return (max - min) / max;
}

function extractStyleHex(style: FigmaFileStyle): string | null {
  if (style.hex) {
    const direct = normalizeHex(style.hex);
    if (direct) {
      return direct;
    }
  }
  const raw = asRecord(style.rawPayload);
  if (!raw) {
    return null;
  }
  const directCandidate = [raw.hex, raw.color, raw.value].find((entry) => typeof entry === "string");
  if (typeof directCandidate === "string") {
    const normalized = normalizeHex(directCandidate);
    if (normalized) {
      return normalized;
    }
  }
  const color = asRecord(raw.color);
  if (color) {
    const fromColor = rgbRecordToHex(color, raw.opacity);
    if (fromColor) {
      return fromColor;
    }
  }
  const fillsHex = extractColorsFromFills(Array.isArray(raw.fills) ? raw.fills : []);
  if (fillsHex) {
    return fillsHex;
  }
  const paints = Array.isArray(raw.paints) ? raw.paints : [];
  for (const paint of paints) {
    const paintRecord = asRecord(paint);
    const paintColor = asRecord(paintRecord?.color);
    const parsed = paintColor ? rgbRecordToHex(paintColor, paintRecord?.opacity) : null;
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function isTypographyStyle(style: FigmaFileStyle): boolean {
  const type = (style.styleType ?? "").toLowerCase();
  if (type.includes("text") || type.includes("typography")) {
    return true;
  }
  const lowerName = style.name.toLowerCase();
  return (
    lowerName.includes("heading") ||
    lowerName.includes("title") ||
    lowerName.includes("body") ||
    lowerName.includes("caption") ||
    lowerName.includes("label")
  );
}

function readTypographyDetails(style: FigmaFileStyle): {
  fontFamily?: string;
  fontWeight?: string | number;
  fontSize?: string | number;
  lineHeight?: string | number;
  letterSpacing?: string | number;
} {
  const raw = asRecord(style.rawPayload);
  if (!raw) {
    return {};
  }
  const styleData = asRecord(raw.style) ?? raw;
  const fontFamily = typeof styleData.fontFamily === "string" ? styleData.fontFamily : undefined;
  const fontWeight =
    typeof styleData.fontWeight === "string" || typeof styleData.fontWeight === "number" ? styleData.fontWeight : undefined;
  const fontSize = typeof styleData.fontSize === "number" || typeof styleData.fontSize === "string" ? styleData.fontSize : undefined;
  const lineHeight =
    typeof styleData.lineHeightPx === "number"
      ? styleData.lineHeightPx
      : typeof styleData.lineHeight === "number" || typeof styleData.lineHeight === "string"
        ? styleData.lineHeight
        : undefined;
  const letterSpacing =
    typeof styleData.letterSpacing === "number" || typeof styleData.letterSpacing === "string"
      ? styleData.letterSpacing
      : undefined;
  return { fontFamily, fontWeight, fontSize, lineHeight, letterSpacing };
}

function detectLocaleFromTextSamples(samples: string[]): "de" | "en" | "unknown" {
  if (samples.length === 0) {
    return "unknown";
  }
  const text = samples.join(" ").toLowerCase();
  const germanSignals = [
    " anmelden",
    " abmelden",
    "warenkorb",
    "anmelden",
    "konto",
    "registrieren",
    "willkommen",
    " in den ",
    "weiter",
    "jetzt kaufen",
    "und ",
    " für ",
    "für ",
    "über ",
    "uber ",
    "nicht ",
    "benutzername",
    "passwort"
  ];
  const hasGermanWord = germanSignals.some((signal) => text.includes(signal));
  const hasUmlaut = /[äöüß]/i.test(text);
  if (hasGermanWord || hasUmlaut) {
    return "de";
  }
  return "en";
}

/** Constitution-aligned defaults when Figma read fails or yields no tokens (educational “base” product). */
export function buildConstitutionFallbackUIKit(): UIKitParsed {
  return UIKitSchema.parse({
    colorPalette: [
      { name: "Primary", hex: "#0D9488", description: "Base template fallback — primary accent (teal)" },
      { name: "Surface", hex: "#F8FAFC", description: "Base template fallback — surface" },
      { name: "Text", hex: "#0F172A", description: "Base template fallback — body text" },
      { name: "Border", hex: "#E2E8F0", description: "Base template fallback — borders" }
    ],
    typography: [
      {
        name: "Heading",
        fontFamily: "system-ui",
        fontWeight: 600,
        fontSize: 24,
        description: "Base template fallback — display / heading"
      },
      {
        name: "Body",
        fontFamily: "system-ui",
        fontWeight: 400,
        fontSize: 16,
        description: "Base template fallback — body"
      },
      {
        name: "Caption",
        fontFamily: "system-ui",
        fontWeight: 400,
        fontSize: 12,
        description: "Base template fallback — caption"
      }
    ],
    componentInventory: [],
    spacing: [],
    radii: [],
    effects: [],
    detectedLocale: "unknown"
  });
}

function assignFunctionalColorNames(uniqueHexes: string[]): Map<string, string> {
  const finalMap = new Map<string, string>();
  if (uniqueHexes.length === 0) {
    return finalMap;
  }
  const meta = uniqueHexes.map((hex) => ({
    hex,
    lum: relativeLuminance(hex),
    sat: saturation01(hex)
  }));
  const assigned = new Set<string>();
  const rawNames = new Map<string, string>();

  const pickPrimary = [...meta].sort((a, b) => b.sat - a.sat || b.lum - a.lum)[0]!.hex;
  rawNames.set(pickPrimary, "Primary");
  assigned.add(pickPrimary);

  const remainingForSurface = meta.filter((m) => !assigned.has(m.hex)).sort((a, b) => b.lum - a.lum);
  if (remainingForSurface[0]) {
    rawNames.set(remainingForSurface[0].hex, "Surface");
    assigned.add(remainingForSurface[0].hex);
  }

  const remainingForText = meta.filter((m) => !assigned.has(m.hex)).sort((a, b) => a.lum - b.lum);
  if (remainingForText[0]) {
    rawNames.set(remainingForText[0].hex, "Text");
    assigned.add(remainingForText[0].hex);
  }

  const extras = ["Secondary", "Accent", "Border", "SurfaceMuted", "TextMuted", "Success", "Warning", "Info"] as const;
  let extraIdx = 0;
  for (const m of [...meta].sort((a, b) => b.sat - a.sat)) {
    if (assigned.has(m.hex)) {
      continue;
    }
    const isGray = m.sat < 0.1;
    const label = isGray ? "Border" : (extras[extraIdx] ?? `Color-${extraIdx + 1}`);
    if (!isGray) {
      extraIdx += 1;
    }
    rawNames.set(m.hex, label);
    assigned.add(m.hex);
  }

  const used = new Map<string, number>();
  for (const hex of uniqueHexes) {
    let name = rawNames.get(hex) ?? "Color";
    const n = (used.get(name) ?? 0) + 1;
    used.set(name, n);
    if (n > 1) {
      name = `${name}-${n}`;
    }
    finalMap.set(hex, name);
  }
  return finalMap;
}

type TypographyKey = string;

function typographyKey(style: Record<string, unknown>): TypographyKey {
  const s = asRecord(style.style) ?? style;
  const ff = typeof s.fontFamily === "string" ? s.fontFamily : "";
  const fw = typeof s.fontWeight === "number" || typeof s.fontWeight === "string" ? String(s.fontWeight) : "";
  const fs = typeof s.fontSize === "number" || typeof s.fontSize === "string" ? String(s.fontSize) : "";
  return `${ff}|${fw}|${fs}`;
}

function readTextStyleFromNode(nodeRecord: Record<string, unknown>): {
  fontFamily?: string;
  fontWeight?: string | number;
  fontSize?: number;
  lineHeight?: string | number;
  letterSpacing?: string | number;
} {
  const style = asRecord(nodeRecord.style);
  if (!style) {
    return {};
  }
  const fontFamily = typeof style.fontFamily === "string" ? style.fontFamily : undefined;
  const fontWeight =
    typeof style.fontWeight === "string" || typeof style.fontWeight === "number" ? style.fontWeight : undefined;
  const fontSize = typeof style.fontSize === "number" ? style.fontSize : undefined;
  const lineHeight =
    typeof style.lineHeightPx === "number"
      ? style.lineHeightPx
      : typeof style.lineHeight === "number" || typeof style.lineHeight === "string"
        ? style.lineHeight
        : undefined;
  const letterSpacing =
    typeof style.letterSpacing === "number" || typeof style.letterSpacing === "string" ? style.letterSpacing : undefined;
  return { fontFamily, fontWeight, fontSize, lineHeight, letterSpacing };
}

const TYPOGRAPHY_ROLE_NAMES = ["Display", "Heading", "Subheading", "Body", "BodySmall", "Caption", "Label", "Meta"] as const;

function coerceFontSize(value: string | number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const n = Number.parseFloat(value.replace(/px$/i, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function assignFunctionalTypographyNames(
  entries: Array<{
    fontFamily?: string;
    fontWeight?: string | number;
    fontSize?: string | number;
    lineHeight?: string | number;
    letterSpacing?: string | number;
    description?: string;
  }>
): UIKitParsed["typography"] {
  const sorted = [...entries].sort((a, b) => coerceFontSize(b.fontSize) - coerceFontSize(a.fontSize));
  return sorted.map((entry, index) => ({
    name: TYPOGRAPHY_ROLE_NAMES[Math.min(index, TYPOGRAPHY_ROLE_NAMES.length - 1)]!,
    fontFamily: entry.fontFamily,
    fontWeight: entry.fontWeight,
    fontSize: entry.fontSize,
    lineHeight: entry.lineHeight,
    letterSpacing: entry.letterSpacing,
    description: entry.description
  }));
}

function parseFigmaFileMetadataFromState(stateJson: Record<string, unknown>): FigmaFileMetadata | null {
  const raw = stateJson.figmaFileMetadata;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const fileKeyFromState =
    typeof stateJson.figmaFileKey === "string" && stateJson.figmaFileKey.trim().length > 0
      ? stateJson.figmaFileKey.trim()
      : null;
  const fileKeyFromMeta = typeof record.fileKey === "string" && record.fileKey.trim().length > 0 ? record.fileKey.trim() : null;
  const fileKey = fileKeyFromState ?? fileKeyFromMeta;
  if (!fileKey) {
    return null;
  }
  const fileName = typeof record.fileName === "string" ? record.fileName : "";
  const document = record.document;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return null;
  }
  const styles: FigmaFileStyle[] = (Array.isArray(record.styles) ? record.styles : [])
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map((entry) => ({
      name: typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name : "Unnamed style",
      key: typeof entry.key === "string" ? entry.key : undefined,
      nodeId: typeof entry.nodeId === "string" ? entry.nodeId : typeof entry.node_id === "string" ? entry.node_id : undefined,
      styleType:
        typeof entry.styleType === "string" ? entry.styleType : typeof entry.style_type === "string" ? entry.style_type : undefined,
      description: typeof entry.description === "string" ? entry.description : undefined,
      hex: typeof entry.hex === "string" ? entry.hex : undefined,
      rawPayload: entry
    }));
  const components: FigmaFileComponent[] = (Array.isArray(record.components) ? record.components : [])
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map((entry) => ({
      name: typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name : "Unnamed component",
      key: typeof entry.key === "string" ? entry.key : undefined,
      nodeId: typeof entry.nodeId === "string" ? entry.nodeId : typeof entry.node_id === "string" ? entry.node_id : undefined,
      description: typeof entry.description === "string" ? entry.description : undefined,
      rawPayload: entry
    }));
  const rawFrameAnalysis = asRecord(record.frameAnalysis);
  const frameAnalysis = {
    commonCornerRadii: Array.isArray(rawFrameAnalysis?.commonCornerRadii)
      ? rawFrameAnalysis.commonCornerRadii.filter((value): value is number => typeof value === "number")
      : [],
    shadowEffects: Array.isArray(rawFrameAnalysis?.shadowEffects)
      ? rawFrameAnalysis.shadowEffects.filter((value): value is string => typeof value === "string")
      : [],
    commonItemSpacing: Array.isArray(rawFrameAnalysis?.commonItemSpacing)
      ? rawFrameAnalysis.commonItemSpacing.filter((value): value is number => typeof value === "number")
      : [],
    commonMaxWidths: Array.isArray(rawFrameAnalysis?.commonMaxWidths)
      ? rawFrameAnalysis.commonMaxWidths.filter((value): value is number => typeof value === "number")
      : []
  };
  const uiKitExtraction = asRecord(record.uiKitExtraction);
  const parsedExtraction =
    uiKitExtraction &&
    typeof uiKitExtraction.targetedPageName === "string" &&
    typeof uiKitExtraction.selectionReason === "string" &&
    typeof uiKitExtraction.readMethod === "string"
      ? {
          targetedPageName: uiKitExtraction.targetedPageName,
          selectionReason: uiKitExtraction.selectionReason,
          readMethod: uiKitExtraction.readMethod
        }
      : undefined;
  return {
    fileKey,
    fileName,
    document: document as FigmaFileNode,
    styles,
    components,
    frameAnalysis,
    uiKitExtraction: parsedExtraction
  };
}

export async function resolveFigmaMetadataForDesignAnalysis(stateJson: Record<string, unknown>): Promise<FigmaFileMetadata> {
  const embedded = parseFigmaFileMetadataFromState(stateJson);
  if (embedded) {
    console.log("[figma] resolveFigmaMetadataForDesignAnalysis: using embedded figmaFileMetadata from state", {
      fileKey: embedded.fileKey,
      fileName: embedded.fileName,
      styleCount: embedded.styles.length,
      componentCount: embedded.components.length
    });
    return embedded;
  }
  const key =
    typeof stateJson.figmaFileKey === "string" && stateJson.figmaFileKey.trim().length > 0 ? stateJson.figmaFileKey.trim() : null;
  if (!key) {
    throw new Error("designAnalysis requires stateJson.figmaFileKey or embedded figmaFileMetadata.");
  }
  console.log("[figma] resolveFigmaMetadataForDesignAnalysis: will fetch live metadata", { fileKey: key });
  return getFigmaFileMetadata(key);
}

export function deriveUIKitFromFigmaMetadata(metadata: FigmaFileMetadata): UIKitParsed {
  const solidHexes: string[] = [];
  const hexSources = new Map<string, string>();
  const textSamples: string[] = [];
  const typoByKey = new Map<
    TypographyKey,
    { fontFamily?: string; fontWeight?: string | number; fontSize?: number; lineHeight?: string | number; letterSpacing?: string | number }
  >();

  const walk = (node: FigmaFileNode): void => {
    const nodeRecord = asRecord(node);
    const fills = Array.isArray(nodeRecord?.fills) ? nodeRecord.fills : [];
    const fillHex = extractColorsFromFills(fills);
    if (fillHex) {
      solidHexes.push(fillHex);
      if (!hexSources.has(fillHex)) {
        hexSources.set(fillHex, `${node.type}: ${node.name}`);
      }
    }
    if (node.type === "TEXT" && nodeRecord) {
      const characters = typeof nodeRecord.characters === "string" ? nodeRecord.characters : null;
      if (characters) {
        textSamples.push(characters);
      }
      const t = readTextStyleFromNode(nodeRecord);
      const key = typographyKey(nodeRecord);
      if ((t.fontFamily || t.fontSize !== undefined) && !typoByKey.has(key)) {
        typoByKey.set(key, t);
      }
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(metadata.document);

  for (const style of metadata.styles) {
    const hex = extractStyleHex(style);
    if (hex && !isTypographyStyle(style)) {
      solidHexes.push(hex);
      if (!hexSources.has(hex)) {
        hexSources.set(hex, `Published style: ${style.name}`);
      }
    }
  }

  const uniqueHexes = [...new Set(solidHexes.map((h) => normalizeHex(h)).filter((h): h is string => Boolean(h)))];
  const nameByHex = assignFunctionalColorNames(uniqueHexes);
  let colorPalette: UIKitParsed["colorPalette"] = uniqueHexes.map((hex) => ({
    name: nameByHex.get(hex) ?? "Color",
    hex,
    description: hexSources.get(hex) ?? "Solid fill from Figma tree"
  }));

  for (const style of metadata.styles) {
    const hex = extractStyleHex(style);
    if (hex && !isTypographyStyle(style) && !colorPalette.some((c) => c.hex === hex)) {
      const extraNames = assignFunctionalColorNames([...uniqueHexes, hex]);
      colorPalette.push({
        name: extraNames.get(hex) ?? style.name,
        hex,
        description: style.description ?? `Published color style: ${style.name}`
      });
    }
  }

  const typoEntries = assignFunctionalTypographyNames([...typoByKey.values()]);
  let typography: UIKitParsed["typography"] = [...typoEntries];

  if (typography.length === 0) {
    typography = assignFunctionalTypographyNames(
      metadata.styles.filter((style) => isTypographyStyle(style)).map((style) => ({
        ...readTypographyDetails(style),
        description: style.description
      }))
    );
  }

  const detectedLocale = detectLocaleFromTextSamples(textSamples);
  const localeNote =
    detectedLocale === "de"
      ? "detectedLocale=de: UI copy appears German."
      : detectedLocale === "en"
        ? "detectedLocale=en."
        : undefined;

  if (localeNote) {
    typography = typography.map((t) => ({
      ...t,
      description: t.description ? `${t.description} (${localeNote})` : localeNote
    }));
  }

  const dedupedComponents = new Map<string, UIKitParsed["componentInventory"][number]>();
  const componentCandidates: FigmaFileComponent[] = [...metadata.components];
  const walkDocument = (node: FigmaFileNode): void => {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      componentCandidates.push({ name: node.name, nodeId: node.id, rawPayload: { nodeType: node.type } });
    }
    for (const child of node.children ?? []) {
      walkDocument(child);
    }
  };
  walkDocument(metadata.document);

  for (const component of componentCandidates) {
    const key = component.name.trim();
    if (!key || dedupedComponents.has(key)) {
      continue;
    }
    const description = component.description;
    dedupedComponents.set(key, {
      name: component.name,
      key: component.key,
      nodeId: component.nodeId,
      description
    });
  }

  if (localeNote) {
    dedupedComponents.set("Locale", { name: "Locale", description: localeNote });
  }

  const spacing = metadata.frameAnalysis.commonItemSpacing.map((value, index) => ({
    name: index === 0 ? "--spacing-md" : index === 1 ? "--spacing-sm" : `--spacing-${index + 1}`,
    value: `${value}px`,
    figmaSource: "Frame itemSpacing"
  }));
  const radii = metadata.frameAnalysis.commonCornerRadii.map((value, index) => ({
    name: index === 0 ? "--radius-lg" : index === 1 ? "--radius-md" : `--radius-${index + 1}`,
    value: `${value}px`,
    figmaSource: "Frame cornerRadius"
  }));
  const effects = metadata.frameAnalysis.shadowEffects.map((value, index) => ({
    name: `--shadow-${index + 1}`,
    value,
    figmaSource: "Frame DROP_SHADOW"
  }));
  const maxWidths = metadata.frameAnalysis.commonMaxWidths.map((value, index) => ({
    name: index === 0 ? "--layout-max-content" : `--layout-max-${index + 1}`,
    value: `${value}px`,
    figmaSource: "Main container width"
  }));

  const fallback = buildConstitutionFallbackUIKit();
  if (colorPalette.length === 0) {
    colorPalette = [...fallback.colorPalette];
  }
  if (typography.length === 0) {
    typography = [...fallback.typography];
  }

  const figmaExtraction = metadata.uiKitExtraction
    ? {
        readMethod: metadata.uiKitExtraction.readMethod,
        targetedPageName: metadata.uiKitExtraction.targetedPageName,
        selectionReason: metadata.uiKitExtraction.selectionReason,
        fileKey: metadata.fileKey
      }
    : {
        readMethod: "embedded_state",
        fileKey: metadata.fileKey
      };

  const parsed = UIKitSchema.parse({
    colorPalette,
    typography,
    componentInventory: Array.from(dedupedComponents.values()),
    spacing: [...spacing, ...maxWidths],
    radii,
    effects,
    detectedLocale,
    figmaExtraction
  });
  console.log("[figma] deriveUIKitFromFigmaMetadata: result summary", {
    fileKey: metadata.fileKey,
    fileName: metadata.fileName,
    colorCount: parsed.colorPalette.length,
    typographyCount: parsed.typography.length,
    componentInventoryCount: parsed.componentInventory.length,
    spacingCount: parsed.spacing.length,
    radiiCount: parsed.radii.length,
    effectsCount: parsed.effects.length,
    detectedLocale: parsed.detectedLocale,
    figmaExtraction: parsed.figmaExtraction
  });
  return parsed;
}
