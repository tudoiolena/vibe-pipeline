import { strToU8, zipSync } from "fflate";
import type { ProjectSpecFile } from "@/lib/project-spec-files";

export function zipRecord(entries: Record<string, string | Uint8Array>): Uint8Array {
  const out: Record<string, Uint8Array> = {};
  for (const [path, value] of Object.entries(entries)) {
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.includes("..")) {
      continue;
    }
    out[normalized] = typeof value === "string" ? strToU8(value) : value;
  }
  if (Object.keys(out).length === 0) {
    throw new Error("No valid files to include in zip.");
  }
  return zipSync(out, { level: 6 });
}

export function specPackToZipEntries(files: ProjectSpecFile[]): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const f of files) {
    const normalized = f.filename.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.includes("..")) {
      continue;
    }
    entries[`project-spec/${normalized}`] = f.content;
  }
  return entries;
}
