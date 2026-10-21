import React, { useEffect, useState } from "react";
import { View, Pressable, AppState, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { shopScanContext, shopScanHref, shopScannerHref } from "@/lib/shopScan";
import * as ImagePicker from "expo-image-picker";
import * as Manipulator from "expo-image-manipulator";
import { pickAndUploadImage } from "@/lib/uploadImage";
import {
  Frame,
  Txt,
  Button,
  Field,
  Chip,
  Notice,
  Section,
  QueryState,
  S,
  C,
} from "@/components/davaq/UI";
import {
  useDavaq,
  useDavaqMutation,
  api,
  key,
  errorText,
  cardLink,
  type Page,
} from "@/lib/tcg";
import { CardArt } from "./Cards";
import { useCachedTcgScans } from "@/lib/useCachedTcgScans";
import {
  type EngineScan as Scan,
  scanNeedsRefresh,
  scanPriceLabel,
} from "@/lib/tcgEngineResult";
export function ScanScreen() {
  const scanParams = useLocalSearchParams(),
    shopContext = shopScanContext(scanParams);
  const r = useRouter(),
    q = useCachedTcgScans(),
    mutation = useDavaqMutation<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [game, setGame] = useState("pokemon"),
    [batch, setBatch] = useState<
      { scan: Scan; quantity: string; condition: string; requestKey: string }[]
    >([]),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true,
      flight = false;
    const refresh = async () => {
      if (flight || AppState.currentState !== "active") return;
      const pending = q.data?.items.filter(scanNeedsRefresh);
      if (!pending?.length) return;
      flight = true;
      try {
        for (const s of pending.slice(0, 5)) {
          if (!live) break;
          await api("/tcg/scans/" + s.id);
        }
        if (live) await q.refetch();
      } catch (e) {
        if (live) setError(errorText(e));
      } finally {
        flight = false;
      }
    };
    const timer = setInterval(() => void refresh(), 6000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [q.data]);
  async function capture(camera: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted)
          throw Error("촬영을 위해 카메라 권한을 허용해 주세요.");
      }
      const result = camera
        ? await ImagePicker.launchCameraAsync({ quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({
            quality: 1,
            allowsMultipleSelection: true,
            selectionLimit: 10,
          });
      if (result.canceled) return;
      for (const asset of result.assets) {
        const prepared = await Manipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 800 } }],
          { compress: 0.65, format: Manipulator.SaveFormat.JPEG },
        );
        const photo = await pickAndUploadImage({
          assets: [
            {
              ...asset,
              ...prepared,
              mimeType: "image/jpeg",
              fileName: "card-scan.jpg",
            },
          ],
        });
        if (!photo) continue;
        await mutation.mutateAsync({
          path: "/tcg/scans",
          body: {
            photo: photo.objectPath,
            game,
            market: "KR",
            requestKey: key(),
          },
        });
      }
      setNotice(
        "사진을 등록했습니다. TCGIndex의 공통 엔진이 카드 정보를 확인합니다.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveBatch() {
    setError("");
    try {
      await mutation.mutateAsync({
        path: "/tcg/collection/bulk",
        body: {
          items: batch.map((b) => ({
            cardId: b.scan.result!.targetId,
            cardName: b.scan.result?.name ?? "",
            quantity: Number(b.quantity),
            condition: b.condition,
            photos: [b.scan.object_path],
            requestKey: b.requestKey,
          })),
        },
      });
      setBatch([]);
      setNotice("확인한 카드를 보유 목록에 일괄 등록했습니다.");
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Frame
      back
      title={shopContext ? "매입 견적 · 연속 스캔" : "사진·연속 촬영 등록"}
      onRefresh={() => void q.refetch()}
    >
      {shopContext && (
        <>
          <Notice>
            인식한 카드의 ‘이 견적에 추가’를 눌러 상태·금액을 확인하세요. 개인
            컬렉션에는 등록되지 않습니다.
          </Notice>
          <Button
            secondary
            label="견적 전체 보기"
            onPress={() =>
              r.replace(
                `/shop/${shopContext.shopId}?quoteId=${shopContext.quoteId}` as any,
              )
            }
          />
        </>
      )}
      <Notice>
        인식용 사진은 TCGIndex 서버에 전송·저장되며 기존 공통 인식 엔진으로
        처리합니다. 얼굴·개인정보 없이 카드만 촬영해 주세요. 판본은 결과를 보고
        직접 확인합니다.
      </Notice>
      <View style={S.wrap}>
        {[
          ["pokemon", "포켓몬"],
          ["one_piece", "원피스"],
          ["magic", "매직"],
          ["yugioh", "유희왕"],
          ["riftbound", "리프트바운드"],
        ].map(([v, l]) => (
          <Chip
            key={v}
            label={l}
            active={game === v}
            onPress={() => setGame(v)}
          />
        ))}
      </View>
      {(!shopContext || Platform.OS !== "web") && (
        <Button
          label="TCGIndex 실시간 스캐너"
          onPress={() =>
            r.push(
              (shopContext
                ? shopScannerHref(shopContext, true)
                : "/tcg/live-scan") as any,
            )
          }
        />
      )}
      <View style={S.row}>
        <Button
          label="다음 카드 촬영"
          busy={busy}
          onPress={() => void capture(true)}
        />
        <Button
          secondary
          label="사진 여러 장 선택"
          disabled={busy}
          onPress={() => void capture(false)}
        />
      </View>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {batch.length > 0 && (
        <>
          <Section title={"등록 대기 " + batch.length + "종"} />
          {batch.map((b, i) => (
            <View style={S.card} key={b.scan.id}>
              <Txt bold>{b.scan.result?.name}</Txt>
              <Field
                label="수량"
                value={b.quantity}
                keyboardType="numeric"
                onChangeText={(v) =>
                  setBatch((p) =>
                    p.map((x, n) => (n === i ? { ...x, quantity: v } : x)),
                  )
                }
              />
              <View style={S.wrap}>
                {["NM", "LP", "MP", "HP", "DMG"].map((c) => (
                  <Chip
                    key={c}
                    label={c}
                    active={b.condition === c}
                    onPress={() =>
                      setBatch((p) =>
                        p.map((x, n) => (n === i ? { ...x, condition: c } : x)),
                      )
                    }
                  />
                ))}
              </View>
              <Button
                small
                secondary
                label="제외"
                onPress={() =>
                  setBatch((p) => p.filter((x) => x.scan.id !== b.scan.id))
                }
              />
            </View>
          ))}
          <Button
            label="확인한 카드 일괄 등록"
            busy={mutation.isPending}
            onPress={() => void saveBatch()}
          />
        </>
      )}
      <Section title="스캔 기록" />
      <QueryState query={q} />
      {q.data?.items.map((s) => (
        <View key={s.id} style={S.card}>
          <View style={S.row}>
            <CardArt src={s.object_path} />
            <View style={{ flex: 1 }}>
              <Txt bold>{s.result?.name || "카드 정보 확인 중"}</Txt>
              <Txt size={12}>{s.result?.number}</Txt>
              <Txt size={12} color={C.muted}>
                {s.result?.cardVerified && s.result?.matchLevel === "printing"
                  ? "동일 판본 확인"
                  : s.result?.cardVerified
                    ? "카드 확인 · 판본 확인 필요"
                    : "카드 확인 중"}
              </Txt>
              <Txt size={13}>{scanPriceLabel(s)}</Txt>
              {s.result?.engineVersion && (
                <Txt size={10} color={C.muted}>
                  엔진 {s.result.engineVersion} · 자료{" "}
                  {s.result.price?.dataVersion ?? "확인 중"}
                </Txt>
              )}
            </View>
          </View>
          {s.result?.targetId && shopContext ? (
            <Button
              label="이 견적에 추가 · 판본·금액 확인"
              onPress={() =>
                r.push(
                  shopScanHref(shopContext, s.result!.targetId!, s.id) as any,
                )
              }
            />
          ) : s.result?.targetId ? (
            <>
              <Button
                secondary
                label="상세·희망 카드 등록"
                onPress={() =>
                  r.push(cardLink(s.result!.targetId!, s.result?.name ?? ""))
                }
              />
              <Button
                label={
                  batch.some((b) => b.scan.id === s.id)
                    ? "등록 대기 목록에 있음"
                    : "판본 확인했고 보유 등록에 추가"
                }
                disabled={
                  batch.length >= 20 || batch.some((b) => b.scan.id === s.id)
                }
                onPress={() =>
                  setBatch((p) => [
                    ...p,
                    {
                      scan: s,
                      quantity: "1",
                      condition: "NM",
                      requestKey: key(),
                    },
                  ])
                }
              />
            </>
          ) : (
            <Button
              secondary
              label="이름·번호로 직접 확인"
              onPress={() => r.push("/(tabs)/agent")}
            />
          )}
          <Button
            small
            secondary
            label="결과 다시 확인"
            onPress={() =>
              void api("/tcg/scans/" + s.id)
                .then(() => q.refetch())
                .catch((e) => setError(errorText(e)))
            }
          />
        </View>
      ))}
    </Frame>
  );
}
