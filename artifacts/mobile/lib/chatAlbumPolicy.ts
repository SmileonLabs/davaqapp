export function albumRows(count: number): number[] {
  const rows: number[] = [];
  while (count > 0) { const size = count % 2 === 1 ? 1 : 2; rows.push(size); count -= size; }
  return rows;
}
export interface ChatAlbumImage { uri: string; thumbnail?: string }
export interface ChatAlbumCollection { hidden: Set<string>; albums: Map<string, ChatAlbumImage[]>; captions: Map<string, string>; representativeById: Map<string, string> }
export function collectChatAlbums<T extends { id: string; senderId: string; type: string; content: string; metadata?: any; deletedAt?: any; roomSeq?: number; _deliveryState?: string; _pending?: boolean }>(messages: T[], previous?: ChatAlbumCollection): ChatAlbumCollection {
  const groups = new Map<string, T[]>();
  for (const item of messages) {
    const id = item.metadata?.albumId;
    // Unacknowledged photos need their own delivery state/retry control. A
    // committed album representative must never hide a failed operation.
    if (item._deliveryState === "failed" || item._deliveryState === "pending" || item._pending || item.id.startsWith("temp-")) continue;
    if (item.type !== "image" || item.deletedAt || typeof id !== "string") continue;
    const key = `${item.senderId}:${id}`;
    const group = groups.get(key) ?? [];
    if (group.length < 10) group.push(item);
    groups.set(key, group);
  }
  const hidden = new Set<string>();
  const representativeById = new Map<string, string>();
  const captions = new Map<string, string>();
  const albums = new Map<string, ChatAlbumImage[]>();
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    items.sort((a, b) => (a.metadata?.albumIndex ?? 0) - (b.metadata?.albumIndex ?? 0));
    // Use the newest committed sequence for visibility/read tracking even when
    // parallel message requests committed in a different order from selection.
    const representative = items.reduce((latest, item) => (item.roomSeq ?? 0) > (latest.roomSeq ?? 0) ? item : latest, items[items.length - 1]);
    items.forEach(item => { representativeById.set(item.id, representative.id); if (item.id !== representative.id) hidden.add(item.id); });
    const caption = items.find(item => typeof item.metadata?.caption === "string")?.metadata.caption;
    if (caption) captions.set(representative.id, caption);
    albums.set(representative.id, items.map(item => ({ uri: item.content, thumbnail: item.metadata?.imageThumbnail })));
  }
  for (const [id, images] of albums) {
    const old = previous?.albums.get(id);
    if (old?.length === images.length && images.every((image, i) => image.uri === old[i].uri && image.thumbnail === old[i].thumbnail)) albums.set(id, old);
  }
  return { hidden, albums, captions, representativeById };
}
