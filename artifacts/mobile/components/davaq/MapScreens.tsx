import React, { useState } from "react";
import { View, Pressable, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  api,
  errorText,
  categories,
  categoryName,
  kindName,
  type Listing,
} from "@/lib/davaq";
import {
  regions,
  approximate,
  directionUrl,
  type Coordinate,
  type ListingGeo,
  type MeetingPoint,
} from "@/lib/maps";
import { currentMapPosition } from "@/lib/mapLocation";
import MapCanvas from "./MapCanvas";
import {
  C,
  S,
  Txt,
  Frame,
  Button,
  Chip,
  Field,
  Notice,
  QueryState,
  ListingImage,
  Icon,
} from "./UI";
export function MapEntry() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="지도에서 교환 찾기"
      onPress={() => router.push("/map" as any)}
      style={[S.card, S.row, { backgroundColor: "#EAF7F1" }]}
    >
      <View style={{ backgroundColor: "white", padding: 12, borderRadius: 16 }}>
        <Icon name="map" color={C.green} size={26} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Txt bold size={17}>
          내 주변, 바꿀 수 있는 것들
        </Txt>
        <Txt size={12} color={C.muted}>
          원하는 물건과 만날 장소를 지도에서 찾아요
        </Txt>
      </View>
      <Txt color={C.green} bold>
        →
      </Txt>
    </Pressable>
  );
}
export function RegionChooser({
  onSelect,
}: {
  onSelect: (p: Coordinate, label: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState("");
  return (
    <View style={{ gap: 10 }}>
      <Button
        small
        secondary
        icon="map-pin"
        label={open ? "지역 선택 닫기" : "지역 선택"}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Field
            label="이동할 지역"
            placeholder="서울, 강남, 부산, 제주…"
            value={text}
            onChangeText={setText}
          />
          <View style={S.wrap}>
            {regions
              .filter((p) => !text || p.label.includes(text.trim()))
              .map((p) => (
                <Chip
                  key={p.label}
                  label={p.label}
                  onPress={() => {
                    onSelect({ lat: p.lat, lng: p.lng }, p.label);
                    setOpen(false);
                  }}
                />
              ))}
          </View>
          <Txt size={11} color={C.muted}>
            가까운 지역을 고른 뒤 지도를 움직여 원하는 동네로 이동하세요.
          </Txt>
        </>
      )}
    </View>
  );
}
export function GeoPicker({
  value,
  onChange,
  privatePlace = false,
}: {
  value?: ListingGeo | MeetingPoint | null;
  onChange: (p: ListingGeo | null) => void;
  privatePlace?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [center, setCenter] = useState<Coordinate>(value ?? regions[0]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const precision = privatePlace
    ? "place"
    : value && "precision" in value
      ? value.precision
      : "area";
  const choose = (p: Coordinate) => {
    const coordinate =
      precision === "area"
        ? approximate(p)
        : { lat: Number(p.lat.toFixed(5)), lng: Number(p.lng.toFixed(5)) };
    onChange({
      ...coordinate,
      precision,
      label: value?.label || (privatePlace ? "약속 장소" : "선택한 동네"),
    });
  };
  const locate = async () => {
    setError("");
    setBusy(true);
    try {
      setCenter(await currentMapPosition());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[S.card, { gap: 12 }]}>
      <View style={S.between}>
        <Txt bold size={15}>
          {privatePlace ? "약속 장소 지도 · 선택" : "지도에 표시할 위치 · 선택"}
        </Txt>
        {!!value && (
          <Chip
            label={
              privatePlace
                ? "참여자만"
                : precision === "area"
                  ? "동네만 공개"
                  : "장소 공개"
            }
          />
        )}
      </View>
      <Txt size={12} color={C.muted}>
        {privatePlace
          ? "교환 참여자에게만 공유돼요. 장소를 바꾸면 새 조건으로 다시 동의해요."
          : "동네만 공개하면 약 1km 단위의 위치로 표시해요. 공개할 만남 장소를 직접 선택할 수도 있어요."}
      </Txt>
      {!privatePlace && value && (
        <View style={S.wrap}>
          <Chip
            label="동네만 공개"
            active={precision === "area"}
            onPress={() =>
              onChange({
                ...value,
                ...approximate(value),
                precision: "area",
                label: "선택한 동네",
              })
            }
          />
          <Chip
            label="만남 장소 공개"
            active={precision === "place"}
            onPress={() => onChange({ ...value, precision: "place" })}
          />
        </View>
      )}
      <Button
        secondary
        small
        label={
          open ? "지도 접기" : value ? "위치 확인·수정" : "지도에서 위치 선택"
        }
        icon="map-pin"
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <View style={S.wrap}>
            <Button
              small
              secondary
              label="내 주변으로 이동"
              busy={busy}
              onPress={() => void locate()}
            />
            <RegionChooser onSelect={(p) => setCenter(p)} />
          </View>
          <MapCanvas
            height={310}
            center={center}
            markers={
              value
                ? [{ ...value, id: "chosen", title: value.label, precision }]
                : []
            }
            selectedId="chosen"
            pickable
            onPick={choose}
            zoom={14}
          />
          <Txt size={12} color={C.purple}>
            지도를 눌러 위치를 선택하세요.
            {precision === "area"
              ? " 선택한 위치는 동네 단위로 조정돼요."
              : " 출입구나 만날 지점을 직접 확인해 주세요."}
          </Txt>
        </>
      )}
      {value && (
        <>
          <Field
            label={
              privatePlace
                ? "약속 장소 이름"
                : precision === "area"
                  ? "공개할 동네 이름"
                  : "공개할 만남 장소 이름"
            }
            placeholder={
              precision === "area" ? "예: 서울 성수동" : "예: 성수역 2번 출구"
            }
            value={value.label}
            maxLength={80}
            onChangeText={(label) => onChange({ ...value, precision, label })}
          />
          <Button
            small
            secondary
            label="지도 위치 지우기"
            onPress={() => onChange(null)}
          />
        </>
      )}
      {!!error && <Notice error>{error}</Notice>}
    </View>
  );
}
export function PlaceMap({
  point,
  approximateArea = false,
  title = "교환 장소",
}: {
  point?: MeetingPoint | null;
  approximateArea?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!point) return null;
  return (
    <View style={[S.card, { gap: 10 }]}>
      <Txt bold>{title}</Txt>
      <Txt>
        {point.label}
        {approximateArea ? " · 동네 근처" : ""}
      </Txt>
      <Button
        small
        secondary
        icon="map"
        label={open ? "지도 접기" : "지도 보기"}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <MapCanvas
          height={280}
          center={point}
          markers={[
            {
              ...point,
              id: "place",
              title: point.label,
              precision: approximateArea ? "area" : "place",
            },
          ]}
          selectedId="place"
          zoom={approximateArea ? 13 : 16}
        />
      )}
      <Txt size={11} color={C.muted}>
        {approximateArea
          ? "정확한 보관 위치가 아닌 동네 표시예요. 만날 장소는 채팅으로 정해 주세요."
          : "참여자가 지정한 위치예요. 실제 출입구와 만날 지점을 함께 확인하세요."}
      </Txt>
      {!approximateArea && (
        <Button
          small
          secondary
          icon="navigation"
          label="카카오맵 길찾기"
          onPress={() => void Linking.openURL(directionUrl(point))}
        />
      )}
    </View>
  );
}
export function ExchangeMapScreen() {
  const router = useRouter(),
    [center, setCenter] = useState<Coordinate>(regions[0]),
    [viewport, setViewport] = useState<Coordinate>(regions[0]),
    [regionLabel, setRegionLabel] = useState("서울 중심"),
    [radius, setRadius] = useState(5),
    [kind, setKind] = useState(""),
    [category, setCategory] = useState(""),
    [showCategories, setShowCategories] = useState(false),
    [mode, setMode] = useState("offer"),
    [text, setText] = useState(""),
    [q, setQ] = useState(""),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [locating, setLocating] = useState(false),
    [focusToken, setFocusToken] = useState(0);
  const search = {
    ...approximate(center),
    radiusKm: radius,
    mode,
    q,
    ...(kind ? { kind } : {}),
    ...(category ? { category } : {}),
  };
  const query = useQuery({
    queryKey: ["davaq", "map-search", search],
    queryFn: () =>
      api<{ items: (Listing & { distanceKm: number })[]; limited: boolean }>(
        "/exchange/map/search",
        "POST",
        search,
      ),
    staleTime: 30000,
  });
  const items = query.data?.items ?? [],
    picked = items.find((l) => l.id === selected),
    markerItems = items.filter((l) => l.geo);
  const move = (p: Coordinate, label: string) => {
    setCenter(approximate(p));
    setViewport(approximate(p));
    setRegionLabel(label);
    setSelected("");
    setFocusToken((v) => v + 1);
  };
  const locate = async () => {
    setLocating(true);
    setError("");
    try {
      move(await currentMapPosition(), "내 주변");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLocating(false);
    }
  };
  const card = (l: Listing & { distanceKm: number }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={l.title + " 상세 보기"}
      key={l.id}
      onPress={() => router.push(("/exchange/listings/" + l.id) as any)}
      style={[
        S.card,
        S.row,
        { borderColor: l.id === selected ? C.purple : C.line },
      ]}
    >
      <View
        style={{ width: 72, height: 72, borderRadius: 15, overflow: "hidden" }}
      >
        <ListingImage listing={l} height={72} />
      </View>
      <View style={{ flex: 1, gap: 5 }}>
        <Txt size={11} color={C.purple}>
          {kindName(l.kind)} · {categoryName(l.category)}
        </Txt>
        <Txt bold>{l.title}</Txt>
        <Txt size={12} color={C.muted}>
          {l.geo?.label} · 약{" "}
          {l.distanceKm < 0.1 ? "100m 이내" : l.distanceKm + "km"}
        </Txt>
        <Txt size={11} color={C.muted}>
          {l.geo?.precision === "area" ? "동네 위치" : "공개 만남 장소"} ·{" "}
          {l.mode === "want" ? "받고 싶은 것" : "줄 수 있는 것"}
        </Txt>
      </View>
      <Txt color={C.purple}>›</Txt>
    </Pressable>
  );
  return (
    <Frame
      back
      title="지도에서 찾기"
      subtitle="가까운 물건과 경험, 지도로 연결해요"
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      <View style={S.between}>
        <View style={{ flex: 1 }}>
          <Txt bold size={20}>
            {regionLabel}
          </Txt>
          <Txt color={C.muted} size={12}>
            선택한 지역 중심 · {radius}km 이내
          </Txt>
        </View>
        <Button
          small
          secondary
          icon="navigation"
          label="내 주변"
          busy={locating}
          onPress={() => void locate()}
        />
      </View>
      <RegionChooser onSelect={move} />
      <View style={S.row}>
        <View style={{ flex: 1 }}>
          <Field
            label="원하는 물건·경험 검색"
            value={text}
            onChangeText={setText}
            maxLength={80}
            placeholder="카메라, 자전거, 기타 레슨…"
            returnKeyType="search"
            onSubmitEditing={() => {
              setQ(text.trim());
              setSelected("");
            }}
          />
        </View>
        <Button
          small
          label="검색"
          onPress={() => {
            setQ(text.trim());
            setSelected("");
          }}
        />
      </View>
      <View style={S.wrap}>
        {[
          ["offer", "줄 수 있는 것"],
          ["want", "받고 싶은 것"],
        ].map(([v, l]) => (
          <Chip
            key={v}
            label={l}
            active={mode === v}
            onPress={() => setMode(v)}
          />
        ))}
      </View>
      <View style={S.wrap}>
        {[
          ["", "전체"],
          ["goods", "물건"],
          ["service", "재능"],
          ["experience", "경험"],
        ].map(([v, l]) => (
          <Chip
            key={v}
            label={l}
            active={kind === v}
            onPress={() => setKind(v)}
          />
        ))}
      </View>
      <Button
        small
        secondary
        label={
          showCategories
            ? "분야 접기"
            : category
              ? categoryName(category) + " · 분야 변경"
              : "분야 선택"
        }
        onPress={() => setShowCategories(!showCategories)}
      />
      {showCategories && (
        <View style={S.wrap}>
          <Chip
            label="모든 분야"
            active={!category}
            onPress={() => setCategory("")}
          />
          {categories.map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              active={category === key}
              onPress={() => setCategory(key)}
            />
          ))}
        </View>
      )}
      <View style={S.wrap}>
        {[1, 3, 5, 10, 20, 50].map((v) => (
          <Chip
            key={v}
            label={v + "km"}
            active={radius === v}
            onPress={() => setRadius(v)}
          />
        ))}
      </View>
      {!!error && <Notice error>{error}</Notice>}
      <QueryState query={query} />
      <MapCanvas
        center={center}
        focusToken={focusToken}
        zoom={radius <= 3 ? 14 : radius <= 10 ? 12 : 10}
        markers={markerItems.map((l) => ({
          ...l.geo!,
          id: l.id,
          title: l.title,
        }))}
        selectedId={selected}
        onSelect={setSelected}
        onMove={setViewport}
        height={410}
      />
      <Button
        secondary
        icon="search"
        label="이 지역 다시 찾기"
        busy={query.isFetching}
        onPress={() => {
          const next = approximate(viewport);
          if (next.lat === center.lat && next.lng === center.lng)
            void query.refetch();
          else move(next, "지도에서 고른 지역");
        }}
      />
      <Txt size={11} color={C.muted}>
        거리는 지도 중심부터의 직선거리예요. 동네 표시는 실제 위치와 차이가
        있어요. 위치 권한 없이도 지역 선택으로 이용할 수 있어요.
      </Txt>
      {picked && (
        <View style={{ gap: 8 }}>
          <Txt color={C.purple} bold>
            지도에서 선택한 교환
          </Txt>
          {card(picked)}
        </View>
      )}
      <View style={S.between}>
        <Txt bold size={18}>
          {query.isSuccess ? "주변 교환 " + items.length + "개" : "주변 교환"}
        </Txt>
        <Button
          small
          secondary
          label="내 위치 등록"
          onPress={() => router.push("/(tabs)/exchanges")}
        />
      </View>
      {items.filter((l) => l.id !== selected).map(card)}
      {query.isSuccess && !items.length && (
        <View style={S.card}>
          <Txt bold size={20}>
            이 근처의 첫 연결을 기다려요
          </Txt>
          <Txt color={C.muted}>
            공개한 지도 위치가 있는 교환만 보여요. 검색 범위를 넓히거나 내
            등록에 동네를 추가해 보세요.
          </Txt>
          <Button
            label="내 교환에 지도 위치 추가"
            onPress={() => router.push("/(tabs)/exchanges")}
          />
          <Button
            secondary
            label="새 교환 등록"
            onPress={() => router.push("/exchange/new?delivery=offline" as any)}
          />
        </View>
      )}
      {query.data?.limited && (
        <Notice>
          가까운 80개를 표시했어요. 범위를 줄이거나 검색어로 원하는 교환을
          찾아보세요.
        </Notice>
      )}
    </Frame>
  );
}
