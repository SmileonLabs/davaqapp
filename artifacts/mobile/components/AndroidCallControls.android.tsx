import { useAuth } from "@clerk/expo";

import React, { useEffect, useState, useRef } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { enqueueCallTermination } from "@/lib/callApi";
import {
  pendingSystemActions,
  telecom,
  subscribeSystemCall,
  systemCallSnapshot,
  selectSystemAudioEndpoint,
  type SystemCallSnapshot,
} from "@/lib/androidTelecom.android";
import type { AndroidCallControlsProps } from "./AndroidCallControls";
export function AndroidCallControls({
  callId,
  onEnd,
  onMute,
  hidden,
  controlsOnly,
}: AndroidCallControlsProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const authenticated = useRef(false);
  authenticated.current = Boolean(isLoaded && isSignedIn);
  const [snapshot, setSnapshot] = useState<SystemCallSnapshot>({});
  const current = useRef({ callId, onEnd, onMute });
  current.current = { callId, onEnd, onMute };
  useEffect(() => {
    let disposed = false,
      draining = false;
    const refresh = () => {
      void systemCallSnapshot()
        .then((value) => {
          if (!disposed) setSnapshot(value);
        })
        .catch(() => {});
    };
    const drain = async () => {
      if (draining || disposed || controlsOnly || !authenticated.current)
        return;
      draining = true;
      try {
        for (const action of await pendingSystemActions()) {
          if (controlsOnly || action.action !== "end") continue;
          await enqueueCallTermination(action.callId);
          if (current.current.callId === action.callId)
            await current.current.onEnd();
          await telecom?.acknowledge(action.id);
        }
      } finally {
        draining = false;
      }
    };
    const run = () => {
      refresh();
      void drain().catch(() => {});
    };
    const unsubscribe = subscribeSystemCall((event) => {
      if (
        !controlsOnly &&
        event.kind === "mute" &&
        event.callId === current.current.callId
      )
        void current.current.onMute(event.value === "true").catch(() => {});
      run();
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    const retry = controlsOnly
      ? undefined
      : setInterval(() => {
          if (AppState.currentState === "active") run();
        }, 5_000);
    run();
    return () => {
      disposed = true;
      if (retry) clearInterval(retry);
      unsubscribe();
      app.remove();
    };
  }, []);
  if (
    hidden ||
    !callId ||
    snapshot.callId !== callId ||
    !snapshot.endpoints?.length
  )
    return null;
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: 8,
      }}
    >
      {snapshot.endpoints.map((endpoint) => (
        <Pressable
          key={endpoint.id}
          accessibilityRole="button"
          accessibilityState={{
            selected: snapshot.currentEndpoint === endpoint.id,
          }}
          onPress={() => {
            void selectSystemAudioEndpoint(callId, endpoint.id).catch(() => {});
          }}
          style={{
            padding: 10,
            borderRadius: 16,
            backgroundColor:
              snapshot.currentEndpoint === endpoint.id ? "#6D35D5" : "#3A3A3A",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 12 }}>{endpoint.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}
