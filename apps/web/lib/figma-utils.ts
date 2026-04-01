/**
 * Extracts the Figma file key from common share URLs (design, file, proto).
 * Example: https://www.figma.com/design/AbCdEf123/My-File → AbCdEf123
 */
export function extractFigmaFileKeyFromFigmaUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]+)(?:\/|$|[?#])/i);
  return match?.[1] ?? null;
}
