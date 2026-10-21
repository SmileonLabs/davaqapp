import React from "react";
export type AndroidCallControlsProps = {
  hidden?: boolean;
  controlsOnly?: boolean;
  callId?: string;
  onEnd: () => Promise<void>;
  onMute: (muted: boolean) => Promise<void>;
};
export function AndroidCallControls(_props: AndroidCallControlsProps) {
  return null;
}
