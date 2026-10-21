import React from "react";
import { useLocalSearchParams } from "expo-router";
import { shopScanContext } from "@/lib/shopScan";
import { ScanScreen } from "./Scan";
import { RegisterScreen } from "./Screens";
export function LiveScanScreen() {
  const p = useLocalSearchParams();
  return shopScanContext(p) ? <ScanScreen /> : <RegisterScreen />;
}
