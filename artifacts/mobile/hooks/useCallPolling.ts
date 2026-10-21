import { useCallback, useEffect } from "react";
import { getGetCallQueryKey, getListIncomingCallsQueryKey, useGetCall, useListIncomingCalls } from "@workspace/api-client-react";
import { callPollingInterval, watchedCallId, type CallMode } from "@/lib/callLifecycle";

export function useCallPolling(args: {
  mode: CallMode;
  activeCallId?: string | null;
  incomingCallId?: string | null;
}) {
  const incomingQuery = useListIncomingCalls({ query: { queryKey: getListIncomingCallsQueryKey(), retry: false }, request: { timeoutMs: 12_000 } });
  const refetchIncoming = useCallback(
    () => incomingQuery.refetch({ cancelRefetch: false }),
    [incomingQuery.refetch],
  );
  useEffect(() => {
    const timer = setInterval(() => { void refetchIncoming(); }, 30_000);
    return () => clearInterval(timer);
  }, [refetchIncoming]);

  const watchId = watchedCallId(args);
  const watchPollMs = callPollingInterval(args.mode);
  const watchedQuery = useGetCall(watchId, { query: { queryKey: getGetCallQueryKey(watchId), retry: false }, request: { timeoutMs: 12_000 } });
  // Refetch defaults to cancelling the previous request when cached data exists.
  // A response slower than our polling interval would otherwise never arrive.
  const refetchWatched = useCallback(
    () => watchedQuery.refetch({ cancelRefetch: false }),
    [watchedQuery.refetch],
  );
  useEffect(() => {
    if (!watchId) return;
    const timer = setInterval(() => { void refetchWatched(); }, watchPollMs);
    return () => clearInterval(timer);
  }, [watchId, watchPollMs, refetchWatched]);

  return {
    incomingList: incomingQuery.data,
    refetchIncoming,
    watched: watchedQuery.data,
    refetchWatched,
    watchId,
  };
}
