import React from "react";
import { useRouter } from "expo-router";
import { useDavaq } from "@/lib/davaq";
import { Button } from "@/components/davaq/UI";
export function ShopInboxLink() {
  const router = useRouter(),
    config = useDavaq<{ available: boolean }>("/shops/config");
  if (!config.data?.available) return null;
  return (
    <Button
      secondary
      label="매장 상담·무료 매장 모드"
      icon="briefcase"
      onPress={() => router.push("/shop" as any)}
    />
  );
}
