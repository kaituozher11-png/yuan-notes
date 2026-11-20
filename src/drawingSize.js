export const DRAWING_WIDTH = 900;
export const DEFAULT_DRAWING_HEIGHT = 420;
export const DRAWING_HEIGHT_STEP = 240;
export const MAX_DRAWING_HEIGHT = 3300;

export function drawingHeight(value) {
  return Number.isFinite(value) && value >= DEFAULT_DRAWING_HEIGHT
    ? Math.min(Math.round(value), MAX_DRAWING_HEIGHT)
    : DEFAULT_DRAWING_HEIGHT;
}

export function nextDrawingHeight(value) {
  return Math.min(drawingHeight(value) + DRAWING_HEIGHT_STEP, MAX_DRAWING_HEIGHT);
}
