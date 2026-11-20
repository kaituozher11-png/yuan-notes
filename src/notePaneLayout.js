export function noteWidthLimits(panelWidth, overlay) {
  const sourceSpace = overlay
    ? panelWidth >= 600 ? Math.max(280, Math.round(panelWidth * .45))
      : panelWidth < 400 ? 12 : Math.max(120, Math.round(panelWidth * .25))
    : 320;
  const max = Math.max(0, Math.floor(panelWidth - sourceSpace - 12));
  return { min: Math.min(overlay ? 220 : 320, max), max };
}

export function clampNoteWidth(requested, panelWidth, overlay) {
  const { min, max } = noteWidthLimits(panelWidth, overlay);
  return Math.max(min, Math.min(max, Math.round(requested)));
}
