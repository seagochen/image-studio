export interface NavigatorPosition { x: number; y: number; }
export interface NavigatorSize { width: number; height: number; }

export function clampNavigatorPosition(position: NavigatorPosition, surface: NavigatorSize, panel: NavigatorSize): NavigatorPosition {
  return {
    x: Math.max(0, Math.min(position.x, Math.max(0, surface.width - panel.width))),
    y: Math.max(0, Math.min(position.y, Math.max(0, surface.height - panel.height))),
  };
}
