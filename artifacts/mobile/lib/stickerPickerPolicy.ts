export const STICKER_PAGE_SIZE = 12;
type Sticker = {
  code: string;
  label: string;
  category: string;
  keywords: string;
};
export function stickerPage<T extends Sticker>(
  catalog: readonly T[],
  category: string,
  query: string,
  requestedPage: number,
) {
  const search = query.trim().toLowerCase();
  const matches = catalog.filter(
    (item) =>
      (category === "전체" || item.category === category) &&
      (!search ||
        `${item.label} ${item.keywords} ${item.code}`
          .toLowerCase()
          .includes(search)),
  );
  const pages = Math.max(1, Math.ceil(matches.length / STICKER_PAGE_SIZE));
  const page = Math.max(0, Math.min(Math.trunc(requestedPage) || 0, pages - 1));
  return {
    items: matches.slice(
      page * STICKER_PAGE_SIZE,
      (page + 1) * STICKER_PAGE_SIZE,
    ),
    page,
    pages,
    total: matches.length,
  };
}
