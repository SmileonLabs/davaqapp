/** Only internal UUID identifiers may survive a multi-screen registration flow. */
export function registrationId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value.toLowerCase()
    : undefined;
}

export function registrationReturnHref(
  target: unknown,
  newListing: unknown,
): string {
  const offered = registrationId(newListing);
  const offer = registrationId(target);
  if (!offered) return "/(tabs)/search";
  return offer
    ? `/(tabs)/search?offerListing=${encodeURIComponent(offer)}&offeredListing=${encodeURIComponent(offered)}`
    : `/(tabs)/search?published=${encodeURIComponent(offered)}`;
}

export function registrationCatalogHref(target?: unknown): string {
  const offer = registrationId(target);
  return `/tcg/catalog?publish=1${offer ? `&offerListing=${encodeURIComponent(offer)}` : ""}`;
}

export function registrationOwnedHref(
  publish: boolean,
  target: unknown,
  owned: unknown,
): string {
  const collection = registrationId(owned);
  if (!collection) return "/(tabs)/exchanges";
  if (!publish)
    return `/(tabs)/exchanges?registered=${encodeURIComponent(collection)}`;
  const offer = registrationId(target);
  return `/tcg/sell?collection=${encodeURIComponent(collection)}${offer ? `&offerListing=${encodeURIComponent(offer)}` : ""}`;
}

/** Insert the authoritative POST response without retaining a duplicate row. */
export function withRegistrationItem<T extends { id: string }>(
  previous: { items: T[] } | undefined,
  item: T,
): { items: T[] } {
  return {
    ...previous,
    items: [
      item,
      ...(previous?.items ?? []).filter((row) => row.id !== item.id),
    ],
  };
}
