import type { AnnotationArrowElement, Point } from "./document";

const MIN_HEAD_LENGTH = 10;
const HEAD_LENGTH_PER_STROKE_WIDTH = 4;
const HEAD_HALF_ANGLE = Math.PI / 7;

/** Layer-local triangle shared by interactive nodes and every raster renderer. */
export function arrowHeadPoints(element: AnnotationArrowElement): [Point, Point, Point] {
  const [start, tip] = element.points;
  const angle = Math.atan2(tip.y - start.y, tip.x - start.x);
  const length = Math.max(MIN_HEAD_LENGTH, element.strokeWidth * HEAD_LENGTH_PER_STROKE_WIDTH);
  const corner = (direction: number): Point => ({
    x: tip.x - length * Math.cos(direction),
    y: tip.y - length * Math.sin(direction),
  });
  return [tip, corner(angle - HEAD_HALF_ANGLE), corner(angle + HEAD_HALF_ANGLE)];
}
