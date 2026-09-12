import React from "react";
import { Linking } from "react-native";
import type { BrandParticipation } from "@/lib/brandExchange";
import { Button, Notice } from "./UI";
export default function BrandVideo({
  initial,
}: {
  initial: BrandParticipation;
  onComplete: () => void;
}) {
  return (
    <>
      <Notice>영상 비교 참여는 현재 DavaQ 웹에서 이용할 수 있어요.</Notice>
      <Button
        label="웹에서 이어하기"
        onPress={() =>
          void Linking.openURL(
            "https://davaq.anothermeai.app/app/brand-exchanges/play/" +
              initial.id,
          )
        }
      />
    </>
  );
}
