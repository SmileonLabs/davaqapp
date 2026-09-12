// Translate pointer coordinates inside a contain-fit video, excluding letterboxing.
export function videoPoint(
  px: number,
  py: number,
  width: number,
  height: number,
  videoWidth: number,
  videoHeight: number,
) {
  if (width <= 0 || height <= 0 || videoWidth <= 0 || videoHeight <= 0)
    return null;
  const scale = Math.min(width / videoWidth, height / videoHeight),
    w = videoWidth * scale,
    h = videoHeight * scale;
  const x = (px - (width - w) / 2) / w,
    y = (py - (height - h) / 2) / h;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
