import { CUBE_LUT_MAX_BYTES, parseCubeLut } from "../domain/cubeLut";

describe("Image Studio CUBE LUT parser", () => {
  it("parses bounded 1D and 3D LUTs with domains", () => {
    const one = parseCubeLut('TITLE "Cyan highlights"\nLUT_1D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n0 0 0\n0 1 1');
    expect(one).toMatchObject({ name: "Cyan highlights", dimension: "1d", size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
    const identity3d = parseCubeLut("LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1");
    expect(identity3d).toMatchObject({ dimension: "3d", size: 2 });
    expect(identity3d.values).toHaveLength(24);
    expect(parseCubeLut('TITLE "Look #1" # trailing comment\nLUT_1D_SIZE 2\n0 0 0\n1 1 1').name).toBe("Look #1");
  });

  it.each([
    ["oversized grid", "LUT_3D_SIZE 34\n"],
    ["non-finite sample", "LUT_1D_SIZE 2\n0 0 0\nNaN 1 1"],
    ["invalid domain", "LUT_1D_SIZE 2\nDOMAIN_MIN 1 0 0\nDOMAIN_MAX 0 1 1\n0 0 0\n1 1 1"],
    ["truncated data", "LUT_3D_SIZE 2\n0 0 0"],
    ["unknown directive", "LUT_1D_SIZE 2\nFOO 1\n0 0 0\n1 1 1"],
  ])("rejects %s", (_name, source) => expect(() => parseCubeLut(source)).toThrow());

  it("rejects files over the byte limit before parsing", () => {
    expect(() => parseCubeLut(" ".repeat(CUBE_LUT_MAX_BYTES + 1))).toThrow("size limit");
  });
});
