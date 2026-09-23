import { imageToStage, screenToDevice, screenToStage, stageToImage, stageToScreen } from "../../../shared/canvas";

describe("Image Studio coordinates", () => {
  it("round-trips screen and stage coordinates at zoom and high DPR", () => {
    const viewport = { offsetX: 31, offsetY: -17, scale: 2.75, devicePixelRatio: 2 };
    const screen = { x: 412.5, y: 206.25 };
    expect(stageToScreen(screenToStage(screen, viewport), viewport)).toEqual(screen);
    expect(screenToDevice(screen, viewport)).toEqual({ x: 825, y: 412.5 });
  });

  it("round-trips rotated and scaled layer coordinates", () => {
    const transform = { x: 80, y: 45, scaleX: 1.5, scaleY: 0.75, rotation: 37 };
    const image = { x: 230, y: 120 };
    const result = stageToImage(imageToStage(image, transform), transform);
    expect(result.x).toBeCloseTo(image.x, 8);
    expect(result.y).toBeCloseTo(image.y, 8);
  });

  it("maps a zoomed and panned pointer into original image pixels", () => {
    const viewport = { offsetX: -120, offsetY: 75, scale: 2, devicePixelRatio: 3 };
    const transform = { x: 40, y: 10, scaleX: 1, scaleY: 1, rotation: 0 };
    expect(stageToImage(screenToStage({ x: 480, y: 485 }, viewport), transform)).toEqual({ x: 260, y: 195 });
  });
});
