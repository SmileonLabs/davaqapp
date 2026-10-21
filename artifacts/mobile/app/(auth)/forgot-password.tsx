import React from "react";
import { Redirect } from "expo-router";

// Old bookmarks enter the current provider flow; installed older clients keep
// their own bundled recovery screen and the existing backend endpoints.
export default function LegacyPasswordEntry() {
  return <Redirect href="/(auth)/sign-in" />;
}
