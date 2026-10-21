export function shouldCaptureChatEdgeBack(g: { x0: number; dx: number; dy: number }, background = false) {
  return (background || g.x0 <= 24) && g.dx > 12 && Math.abs(g.dy) < g.dx / 2;
}
export function shouldCompleteChatEdgeBack(g: { dx: number; vx: number }, width: number) {
  return g.dx > width * 0.3 || (g.dx > 40 && g.vx > 0.6);
}
