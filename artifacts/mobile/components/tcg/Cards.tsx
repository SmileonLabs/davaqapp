import React, { useState, useEffect, useRef } from "react";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMediaResource } from "@/hooks/useMediaUri";
import { useBrowserChatPhoto } from "@/hooks/useBrowserChatPhoto";
import {
  publicCardImageSources,
  CARD_IMAGE_ATTEMPT_TIMEOUT_MS,
} from "@/lib/publicCardImagePolicy";
import { C, S, Txt, Icon } from "@/components/davaq/UI";
import {
  conditionName,
  money,
  cardLink,
  useDavaq,
  type Detail,
  type CatalogCard,
  type Listing,
} from "@/lib/tcg";
type CardArtProps = {
  src?: string | null;
  large?: boolean;
  catalog?: boolean;
  priority?: "high" | "normal" | "low";
};
export function CollectionCardArt({ card, large = true }: { card: { card_id: string; card_name: string; photos?: string[]; image_src?: string | null }; large?: boolean }) {
  const photo = card.photos?.find(value => !!value);
  const catalogImage = card.image_src;
  const detail = useDavaq<Detail>("/tcg/catalog/detail?id=" + encodeURIComponent(card.card_id) + "&name=" + encodeURIComponent(card.card_name), !photo && !catalogImage);
  return <CardArt src={photo || catalogImage || detail.data?.target.imageSrc} large={large} catalog={!photo} />;
}
export function CardArt(props: CardArtProps) {
  return <CardArtSource key={props.src ?? "empty"} {...props} />;
}
function CardArtSource({
  src,
  large = false,
  catalog = false,
  priority = "normal",
}: CardArtProps) {
  const [square, setSquare] = useState(false);
  const [fallback, setFallback] = useState(false),
    [failed, setFailed] = useState(false);
  const [loadedSource, setLoadedSource] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0),
    [retrying, setRetrying] = useState(false);
  const sources = publicCardImageSources(src);
  const privatePhoto = sources.kind === "private";
  const nativeMedia = useMediaResource(
    privatePhoto && Platform.OS !== "web" ? src : undefined,
  );
  const browserPhoto = useBrowserChatPhoto(
    privatePhoto && Platform.OS === "web" ? (src ?? undefined) : undefined,
    attempt,
  );
  const value = privatePhoto
    ? Platform.OS === "web"
      ? browserPhoto?.uri
      : nativeMedia.uri
    : fallback
      ? sources.fallback
      : sources.primary;
  const identity = String(value) + ":" + attempt;
  const current = useRef({ identity, loaded: false });
  if (current.current.identity !== identity)
    current.current = { identity, loaded: false };
  const loaded = !!value && loadedSource === identity;
  const fail = () => {
    if (current.current.identity !== identity || current.current.loaded) return;
    if (!privatePhoto && !fallback && sources.fallback) setFallback(true);
    else setFailed(true);
  };
  useEffect(() => {
    if (
      privatePhoto &&
      (Platform.OS === "web" ? browserPhoto?.error : nativeMedia.error)
    )
      setFailed(true);
  }, [privatePhoto, browserPhoto?.error, nativeMedia.error]);
  useEffect(() => {
    if (!value || loaded || failed) return;
    const timer = setTimeout(fail, CARD_IMAGE_ATTEMPT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [identity, loaded, failed, fallback]);
  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      if (privatePhoto && Platform.OS !== "web") {
        const result = await nativeMedia.refresh();
        if (result?.error) throw result.error;
      }
      setLoadedSource(undefined);
      setFallback(false);
      setAttempt((value) => value + 1);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRetrying(false);
    }
  }
  return (
    <View
      style={{
        width: large ? "100%" : 88,
        aspectRatio: 63 / 88,
        maxHeight: large ? undefined : 122,
        overflow: "hidden",
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {value && !failed ? (
        <Image
          key={identity}
          source={{ uri: value }}
          recyclingKey={identity}
          cachePolicy="memory-disk"
          contentFit="contain"
          priority={priority}
          onLoad={({ source: { width, height } }) => {
            if (current.current.identity !== identity) return;
            current.current.loaded = true;
            setSquare(height > 0 && Math.abs(width / height - 1) < 0.02);
            setLoadedSource(identity);
            setFailed(false);
          }}
          onDisplay={() => {
            if (current.current.identity === identity) {
              current.current.loaded = true;
              setLoadedSource(identity);
              setFailed(false);
            }
          }}
          onError={fail}
          style={{
            width: "100%",
            height: "100%",
            transform: [{ scale: catalog && loaded && square ? 1.75 : 1 }],
          }}
        />
      ) : failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="카드 이미지 다시 불러오기"
          disabled={retrying}
          accessibilityState={{ disabled: retrying, busy: retrying }}
          onPress={() => void retry()}
          style={{
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            height: "100%",
            backgroundColor: "#F3F3F3",
          }}
        >
          <Icon name="refresh-cw" size={24} color={C.muted} />
          <Txt size={11} color={C.muted}>
            {retrying ? "사진 확인 중" : "다시 불러오기"}
          </Txt>
        </Pressable>
      ) : (
        <Icon name="layers" size={32} />
      )}
      {(value || privatePhoto) && !failed && !loaded && (
        <View
          pointerEvents="none"
          accessibilityRole="progressbar"
          accessibilityLabel="카드 이미지 불러오는 중"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: "#F3F3F3",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <ActivityIndicator size="small" color="#888888" />
          <Txt size={11} color={C.muted}>
            불러오는 중
          </Txt>
        </View>
      )}
    </View>
  );
}

export function CatalogRow({
  card,
  onPress,
}: {
  card: CatalogCard;
  onPress?: () => void;
}) {
  const r = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress ?? (() => r.push(cardLink(card.saveId, card.title)))}
      style={[S.card, { padding: 4, borderWidth: 0, gap: 8 }]}
    >
      <View
        style={{
          backgroundColor: "transparent",
          alignItems: "center",
          paddingVertical: 2,
          borderRadius: 10,
        }}
      >
        <CardArt src={card.imageSrc} large catalog />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Txt bold size={14} lines={2}>
          {card.title}
        </Txt>
        <Txt size={12} color={C.muted}>
          {card.identifier} · {card.badges?.join(" · ")}
        </Txt>
        <Txt bold color={C.purple}>
          {card.price ?? money(card.amount)}
        </Txt>
        <Txt size={11} color={C.muted}>
          {card.priceLabel ?? "참고 가격"} ·{" "}
          {card.observedAt?.slice(0, 10) ?? "관측일 미확인"}
        </Txt>
      </View>
    </Pressable>
  );
}
export function ListingRow({ listing: l }: { listing: Listing }) {
  const r = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => r.push(("/tcg/listing/" + l.id) as any)}
      style={[S.card, { padding: 4, borderWidth: 0, gap: 8 }]}
    >
      <View
        style={{
          backgroundColor: "transparent",
          alignItems: "center",
          paddingVertical: 2,
          borderRadius: 10,
        }}
      >
        <CollectionCardArt card={l} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Txt size={12} color={C.purple}>
          {l.mode === "sale"
            ? "판매"
            : l.mode === "swap"
              ? "교환"
              : "판매·교환"}{" "}
          · {conditionName(l.condition)}
        </Txt>
        <Txt bold size={14} lines={2}>
          {l.card_name}
        </Txt>
        <Txt bold>
          {l.mode === "sale" ? money(l.price) : "↔ 이 카드로 구해요"}
        </Txt>
        {l.mode !== "sale" && (
          <Txt size={12}>
            {l.wanted_card_names?.length
              ? l.wanted_card_names.join(" · ")
              : l.wanted_card_ids.length
                ? `희망 카드 ${l.wanted_card_ids.length}종 · 상세에서 확인`
                : "희망 카드 협의"}
          </Txt>
        )}
        <Txt size={12} color={C.muted}>
          {l.region || "지역 협의"} · {l.quantity}장 ·{" "}
          {l.delivery === "meet"
            ? "직거래"
            : l.delivery === "ship"
              ? "배송"
              : "직거래·배송"}
        </Txt>
      </View>
    </Pressable>
  );
}
