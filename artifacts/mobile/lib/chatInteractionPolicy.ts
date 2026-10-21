export type MessageAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export function focusLayout(
  anchor: MessageAnchor | undefined,
  width: number,
  height: number,
  topInset = 24,
  bottomInset = 24,
) {
  const top = Math.max(12, topInset),
    bottom = Math.max(top + 180, height - bottomInset - 12);
  const previewHeight = Math.min(anchor?.height ?? 80, (bottom - top) * 0.38);
  const y = Math.max(
    top + 56,
    Math.min(anchor?.y ?? top + 56, bottom - previewHeight - 180),
  );
  return {
    x: Math.max(
      12,
      Math.min(
        anchor?.x ?? 12,
        width - Math.min(anchor?.width ?? 280, width - 24) - 12,
      ),
    ),
    y,
    width: Math.min(anchor?.width ?? 280, width - 24),
    previewHeight,
    menuHeight: Math.max(100, bottom - y - previewHeight - 8),
  };
}
export function groupReactions(
  badges: ReadonlyArray<{ code: string; userId: string }>,
  viewerId?: string,
) {
  const groups = new Map<
    string,
    { code: string; count: number; mine: boolean }
  >();
  const seen = new Set<string>();
  for (const badge of badges) {
    if (seen.has(badge.userId)) continue;
    seen.add(badge.userId);
    const group = groups.get(badge.code) ?? {
      code: badge.code,
      count: 0,
      mine: false,
    };
    group.count++;
    group.mine ||= badge.userId === viewerId;
    groups.set(badge.code, group);
  }
  return [...groups.values()];
}
export function toggleMessageSelection(ids: readonly string[], id: string) {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

// Commit each successful item immediately. A later failure leaves only the
// uncommitted items selected; an account/room switch stops the remaining work.
export async function runScopedMessageBatch<T>({
  items,
  isCurrent,
  send,
  onCommitted,
}: {
  items: readonly T[];
  isCurrent: () => boolean;
  send: (item: T) => Promise<unknown>;
  onCommitted: (item: T) => void;
}): Promise<boolean> {
  for (const item of items) {
    if (!isCurrent()) return false;
    await send(item);
    if (!isCurrent()) return false;
    onCommitted(item);
  }
  return true;
}
