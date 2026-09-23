import { colorSchemeSwatches, hexToHsv, hsvToHex } from "../domain/color";

describe("Image Studio color wheel", () => {
  it.each([
    ["#ff0000", 0],
    ["#00ff00", 120],
    ["#0000ff", 240],
  ])("round-trips %s through HSV", (hex, hue) => {
    const hsv = hexToHsv(hex);
    expect(hsv).toMatchObject({ hue, saturation: 1, value: 1 });
    expect(hsvToHex(hsv.hue, hsv.saturation, hsv.value)).toBe(hex);
  });

  it("preserves value and saturation for non-primary colors", () => {
    const hsv = hexToHsv("#336699");
    expect(hsvToHex(hsv.hue, hsv.saturation, hsv.value)).toBe("#336699");
  });
});

describe("colorSchemeSwatches", () => {
  it("returns no swatches for monochromatic (varies value/saturation, not hue)", () => {
    expect(colorSchemeSwatches("#ff0000", "monochromatic")).toEqual([]);
  });

  it.each([
    ["complementary", 2],
    ["splitComplementary", 3],
    ["analogous", 3],
    ["triadic", 3],
    ["tetradic", 4],
  ] as const)("returns %s swatches for %s, base color first", (scheme, count) => {
    const swatches = colorSchemeSwatches("#ff0000", scheme);
    expect(swatches).toHaveLength(count);
    expect(swatches[0]).toEqual({ hex: "#ff0000", labelKey: "harmonyBase" });
  });

  it("rotates hue by the scheme's rule while preserving saturation and value", () => {
    const swatches = colorSchemeSwatches("#ff0000", "complementary");
    expect(swatches[1]).toEqual({ hex: "#00ffff", labelKey: "harmonyComplementary" });
  });

  it("gives triadic swatches hues 120 degrees apart", () => {
    const swatches = colorSchemeSwatches("#ff0000", "triadic");
    // hsvToHex quantizes to 8-bit RGB, so a round trip through hex can be off
    // by a fraction of a degree — assert within a tolerance, not exact equality.
    const hues = swatches.map((s) => hexToHsv(s.hex).hue);
    [0, 120, 240].forEach((expected, index) => expect(hues[index]).toBeCloseTo(expected, 0));
  });

  it("gives tetradic swatches hues 90 degrees apart", () => {
    const swatches = colorSchemeSwatches("#ff0000", "tetradic");
    const hues = swatches.map((s) => hexToHsv(s.hex).hue);
    [0, 90, 180, 270].forEach((expected, index) => expect(hues[index]).toBeCloseTo(expected, 0));
  });
});
