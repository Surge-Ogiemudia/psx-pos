import { parseNumeric } from "@/lib/numberInput";

describe("parseNumeric", () => {
  it("passes plain numbers through unchanged", () => {
    expect(parseNumeric(42)).toBe(42);
    expect(parseNumeric(0)).toBe(0);
  });

  it("parses numeric strings", () => {
    expect(parseNumeric("42")).toBe(42);
    expect(parseNumeric("42.5")).toBe(42.5);
  });

  it("strips thousands-separator commas", () => {
    expect(parseNumeric("1,000")).toBe(1000);
    expect(parseNumeric("1,234.50")).toBe(1234.5);
  });

  it("trims surrounding whitespace", () => {
    expect(parseNumeric("  100  ")).toBe(100);
  });

  it("returns NaN for empty or non-numeric input", () => {
    expect(parseNumeric("")).toBeNaN();
    expect(parseNumeric("   ")).toBeNaN();
    expect(parseNumeric("abc")).toBeNaN();
  });

  it("returns NaN for non-string, non-number values", () => {
    expect(parseNumeric(null)).toBeNaN();
    expect(parseNumeric(undefined)).toBeNaN();
    expect(parseNumeric({})).toBeNaN();
  });
});
