import { currentMapPosition } from "@/lib/mapLocation";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import MapCanvas from "@/components/davaq/MapCanvas";
import { regions, approximate, type Coordinate } from "@/lib/maps";
import { api, useDavaq, type Listing, type Page } from "@/lib/tcg";
import { Button, Chip, Notice, Txt, S } from "@/components/davaq/UI";
import { ListingRow } from "./Cards";
export function ExchangeMap({ search }: { search: string }) {
  const config = useDavaq<{ tileUrl: string }>("/tcg/map/config");
  const [center, setCenter] = useState<Coordinate>(regions[0]),
    [items, setItems] = useState<Listing[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [truncated, setTruncated] = useState(false);
  async function load(p: Coordinate) {
    setBusy(true);
    setError("");
    try {
      const data = await api<Page<Listing> & { truncated: boolean }>(
        "/tcg/map/search",
        "POST",
        { ...approximate(p), q: search },
      );
      setItems(data.items);
      setTruncated(data.truncated);
    } catch (e) {
      setError("지도 매물을 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (config.data) void load(center);
  }, [search, config.data]);
  return (
    <View style={{ gap: 12 }}>
      <Button
        secondary
        label="내 주변 교환 찾기"
        icon="navigation"
        onPress={() => {
          void currentMapPosition()
            .then((p) => {
              setCenter(p);
              void load(p);
            })
            .catch((e) => setError(e.message));
        }}
      />
      <View style={S.wrap}>
        {regions.slice(0, 10).map((p) => (
          <Chip
            key={p.label}
            label={p.label}
            onPress={() => {
              setCenter(p);
              void load(p);
            }}
          />
        ))}
      </View>
      <MapCanvas
        center={center}
        markers={items
          .filter((l) => l.map_lat != null && l.map_lng != null)
          .map((l) => ({
            id: l.id,
            title: l.card_name,
            precision: "area" as const,
            lat: l.map_lat!,
            lng: l.map_lng!,
          }))}
        selectedId={selected}
        onSelect={setSelected}
        onMove={setCenter}
      />
      <Button
        secondary
        label="이 지역 다시 찾기"
        busy={busy}
        onPress={() => void load(center)}
      />
      <Txt size={12}>
        공개 동네 위치입니다. 정확한 만남 장소는 채팅에서 협의해 주세요.
      </Txt>
      {error && <Notice error>{error}</Notice>}
      {truncated && (
        <Notice>
          가까운 매물 80개까지 표시합니다. 지역을 좁혀 다시 찾아주세요.
        </Notice>
      )}
      {!busy && !error && !items.length && (
        <Notice>이 지역에 위치를 공개한 교환 카드가 아직 없어요.</Notice>
      )}
      {items
        .filter((l) => !selected || l.id === selected)
        .map((l) => (
          <ListingRow key={l.id} listing={l} />
        ))}
      {selected && (
        <Button
          secondary
          label="전체 결과 보기"
          onPress={() => setSelected("")}
        />
      )}
    </View>
  );
}
export function MapPicker({
  value,
  onChange,
}: {
  value: Coordinate | null;
  onChange: (p: Coordinate | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 12 }}>
      <Button
        secondary
        label={open ? "지도 닫기" : "교환할 동네를 지도에 공개 (선택)"}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Notice>
            지도를 눌러 동네를 선택하세요. 약 1km 단위로 공개하며 집 주소나 현재
            위치는 자동 등록하지 않습니다.
          </Notice>
          <View style={S.wrap}>
            {regions.slice(0, 10).map((p) => (
              <Chip
                key={p.label}
                label={p.label}
                onPress={() => onChange(approximate(p))}
              />
            ))}
          </View>
          <MapCanvas
            center={value ?? regions[0]}
            markers={
              value ? [{ ...value, id: "pick", title: "공개할 동네" }] : []
            }
            pickable
            onPick={(p) => onChange(approximate(p))}
          />
          {value && (
            <>
              <Txt size={12}>
                선택한 동네: {value.lat.toFixed(2)}, {value.lng.toFixed(2)}
              </Txt>
              <Button
                secondary
                label="위치 공개 안 함"
                onPress={() => onChange(null)}
              />
            </>
          )}
        </>
      )}
    </View>
  );
}
