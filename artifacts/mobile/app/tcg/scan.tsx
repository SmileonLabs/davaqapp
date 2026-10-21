import React from "react";
import { Platform } from "react-native";
import { Redirect } from "expo-router";
import { ScanScreen } from "@/components/tcg/Scan";
export default function ScanRoute() { return Platform.OS === "web" ? <Redirect href={"/tcg/catalog" as any}/> : <ScanScreen/>; }
