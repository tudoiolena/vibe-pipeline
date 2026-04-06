/**
 * Returns true when the value is a non-empty string parseable as URL with http: or https: scheme.
 * Used to decide whether to render an external repo link on the home project list.
 */
export function isDisplayableHttpUrl(raw: string | null | undefined): raw is string {
  if (raw == null) {
    return false;
  }
  const s = raw.trim();
  if (s.length === 0) {
    return false;
  }
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
