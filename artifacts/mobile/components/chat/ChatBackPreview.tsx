import React from "react";
import { View } from "react-native";
// Render the same inbox using cached queries, with navigation/polling disabled.
// No duplicate chat room or reading-position controller is mounted here.
export function ChatBackPreview() {
  // Lazy load after the route module is initialized (Inbox embeds ChatScreen on tablets).
  const { InboxScreen } =
    require("@/components/davaq/InboxScreen") as typeof import("@/components/davaq/InboxScreen");
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", inset: 0 }}
    >
      <InboxScreen preview />
    </View>
  );
}
