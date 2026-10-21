import { notifyManager, type QueryClient } from "@tanstack/react-query";

export interface ProfileQueryDescriptor {
  queryKey: readonly unknown[];
}

export type ProfileQueryCache = Pick<
  QueryClient,
  "cancelQueries" | "removeQueries" | "getQueryCache"
>;

export const CHARACTER_PROFILES_ROOT_KEY = "character-profiles";

export function isProfileScopedQuery(query: ProfileQueryDescriptor): boolean {
  return query.queryKey[0] !== CHARACTER_PROFILES_ROOT_KEY;
}

/**
 * Remove the previous character's data and reattach mounted observers to fresh
 * queries. Removing an active query alone leaves its observer on an orphaned
 * query, so an in-flight home/feed request can remain pending indefinitely.
 * resetQueries is also unsuitable: it can restore a previous initialData value.
 */
export function purgeProfileScopedQueries(
  queryClient: ProfileQueryCache,
): void {
  const observers = queryClient
    .getQueryCache()
    .findAll({ predicate: isProfileScopedQuery })
    .flatMap((query) => [...query.observers]);
  notifyManager.batch(() => {
    void queryClient.cancelQueries(
      { predicate: isProfileScopedQuery },
      { revert: false, silent: true },
    );
    queryClient.removeQueries({ predicate: isProfileScopedQuery });
    for (const observer of observers) {
      observer.setOptions({
        ...observer.options,
        initialData: undefined,
        initialDataUpdatedAt: undefined,
        placeholderData: undefined,
      });
    }
  });
}

/**
 * Apply the request-context fence before a newly fetched active profile is
 * returned to React Query. This covers server/other-tab profile switches, not
 * only mutations initiated by the current screen.
 */
export function prepareProfileStateTransition(
  queryClient: ProfileQueryCache,
  previousProfileId: string | null | undefined,
  nextProfileId: string,
  setRequestProfile: (profileId: string) => void,
): boolean {
  // The session query client is already isolated by authenticated identity.
  // First profile hydration must not destroy its newly mounted queries.
  const switched =
    previousProfileId != null && previousProfileId !== nextProfileId;
  setRequestProfile(nextProfileId);
  if (switched) purgeProfileScopedQueries(queryClient);
  return switched;
}
