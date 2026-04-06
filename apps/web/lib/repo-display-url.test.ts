import { describe, expect, it } from "vitest";
import { isDisplayableHttpUrl } from "./repo-display-url";

describe("isDisplayableHttpUrl", () => {
  it("returns false for null, undefined, empty, whitespace", () => {
    expect(isDisplayableHttpUrl(null)).toBe(false);
    expect(isDisplayableHttpUrl(undefined)).toBe(false);
    expect(isDisplayableHttpUrl("")).toBe(false);
    expect(isDisplayableHttpUrl("   ")).toBe(false);
  });

  it("returns false for non-http(s) schemes", () => {
    expect(isDisplayableHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isDisplayableHttpUrl("ftp://example.com/repo")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isDisplayableHttpUrl("not a url")).toBe(false);
  });

  it("returns true for http and https URLs", () => {
    expect(isDisplayableHttpUrl("https://github.com/org/repo")).toBe(true);
    expect(isDisplayableHttpUrl("http://example.com/a")).toBe(true);
  });
});
