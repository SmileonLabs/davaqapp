import {hasCollectorLoungeEntry} from '@/lib/collectorLoungeEntry';
import React, { useEffect, useState } from "react";
import { useAuth } from "@/lib/davaqAuth";
import { Redirect } from "expo-router";
import { StartupSplash } from "@/components/StartupSplash";
import { loadPendingInvite } from "@/lib/inviteLinks";
export default function Index() {
  const { isLoaded, isSignedIn } = useAuth(),
    [pending, setPending] = useState<string | null | undefined>(),
    [collectorEntry,setCollectorEntry]=useState(false);
  useEffect(() => {
    if (isLoaded && isSignedIn)
      void Promise.all([loadPendingInvite(),hasCollectorLoungeEntry()])
        .then(([invite,collector])=>{setCollectorEntry(collector);setPending(invite);})
        .catch(() => setPending(null));
  }, [isLoaded, isSignedIn]);
  if (!isLoaded || (isSignedIn && pending === undefined))
    return <StartupSplash />;
  return (
    <Redirect
      href={
        !isSignedIn
          ? "/(auth)/sign-in"
          : pending
            ? { pathname: "/friends/add", params: { code: pending } }
            : collectorEntry ? "/collector-lounge" : "/(tabs)"
      }
    />
  );
}
