import type { CSSProperties } from "react";
import type { PRD } from "@vibe/schema";

const FALLBACK_BADGE_COLOR = "#64748b";

function normalizeHexColor(input: string): string | null {
  const value = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const [, r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function getReadableTextColor(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.65 ? "#0f172a" : "#ffffff";
}

export function getDynamicBadgeStyle(techObj: PRD["techStack"][number]): CSSProperties {
  const normalizedColor = normalizeHexColor(techObj.color) ?? FALLBACK_BADGE_COLOR;
  return {
    backgroundColor: normalizedColor,
    borderColor: normalizedColor,
    color: getReadableTextColor(normalizedColor)
  };
}
