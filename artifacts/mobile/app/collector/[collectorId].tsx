import React from "react";
import { useLocalSearchParams } from "expo-router";
import { CollectorProfileScreen } from "@/components/davaq/CollectorProfile";
export default function CollectorProfileRoute() {
  const { collectorId } = useLocalSearchParams<{ collectorId: string }>();
  return <CollectorProfileScreen collectorId={collectorId} />;
}
