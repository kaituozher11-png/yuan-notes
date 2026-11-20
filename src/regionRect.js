const MIN_SIZE = 0.015;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function moveRegionRect(rect, dx, dy) {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, 1 - rect.width),
    y: clamp(rect.y + dy, 0, 1 - rect.height),
  };
}

export function resizeRegionRect(rect, handle, point) {
  let left = rect.x;
  let right = rect.x + rect.width;
  let top = rect.y;
  let bottom = rect.y + rect.height;
  if (handle.includes('w')) left = clamp(point.x, 0, right - MIN_SIZE);
  if (handle.includes('e')) right = clamp(point.x, left + MIN_SIZE, 1);
  if (handle.includes('n')) top = clamp(point.y, 0, bottom - MIN_SIZE);
  if (handle.includes('s')) bottom = clamp(point.y, top + MIN_SIZE, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
