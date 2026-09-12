import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { customFetch } from "@workspace/api-client-react";
import { resolveMediaUri } from "@/hooks/useMediaUri";
import { errorText } from "@/lib/davaq";
import { videoPoint } from "@/lib/brandVideoGeometry";
import { Txt, Button, Notice, Field, S, C } from "./UI";
import type { Difference } from "./BrandCreativeEditor";
export default function BrandCreativeEditor({
  onChange,
}: {
  onChange: (a: string, b: string, answers: Difference[]) => void;
}) {
  const [paths, setPaths] = useState(["", ""]),
    [urls, setUrls] = useState(["", ""]),
    [answers, setAnswers] = useState<Difference[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [start, setStart] = useState("0"),
    [end, setEnd] = useState("30"),
    origin = useRef<{ x: number; y: number } | null>(null),
    a = useRef<HTMLVideoElement>(null),
    b = useRef<HTMLVideoElement>(null);
  useEffect(() => onChange(paths[0], paths[1], answers), [paths, answers]);
  async function upload(file: File | undefined, i: number) {
    if (!file) return;
    setError("");
    if (file.size > 25 * 1024 * 1024) {
      setError("영상은 25MB 이하로 등록해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const result = await customFetch<{ objectPath: string }>(
        "/api/brand-admin/uploads",
        {
          method: "POST",
          headers: { "Content-Type": "video/mp4" },
          body: file,
        },
      );
      const url = await resolveMediaUri(result.objectPath);
      setPaths((old) => old.map((v, n) => (n === i ? result.objectPath : v)));
      setUrls((old) => old.map((v, n) => (n === i ? url : v)));
      setAnswers([]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function point(e: React.PointerEvent<HTMLVideoElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return videoPoint(
      e.clientX - r.left,
      e.clientY - r.top,
      r.width,
      r.height,
      e.currentTarget.videoWidth,
      e.currentTarget.videoHeight,
    );
  }
  function mark(e: React.PointerEvent<HTMLVideoElement>) {
    const p = point(e),
      from = origin.current;
    origin.current = null;
    if (!p || !from) return;
    const region = {
      x: Math.min(from.x, p.x),
      y: Math.min(from.y, p.y),
      w: Math.abs(from.x - p.x),
      h: Math.abs(from.y - p.y),
      start: Number(start),
      end: Number(end),
    };
    if (
      region.w < 0.04 ||
      region.h < 0.04 ||
      region.w > 0.7 ||
      region.h > 0.7 ||
      region.end <= region.start ||
      region.start < 0 ||
      region.end > 30
    ) {
      setError("영역은 영상의 4~70%, 정답 시간은 0~30초 안에서 설정해 주세요.");
      return;
    }
    if (answers.length >= 3) {
      setError("정답은 2~3개까지 설정할 수 있어요.");
      return;
    }
    setError("");
    setAnswers([...answers, region]);
  }
  return (
    <View style={{ gap: 12 }}>
      <Txt bold>30초 MP4 영상 두 개</Txt>
      <Txt size={12}>
        동일한 크기의 원본과 수정본을 올려주세요. 각 25MB 이하이며 원본에만
        소리가 재생돼요.
      </Txt>
      {[0, 1].map((i) => (
        <View key={i} style={{ gap: 8 }}>
          <label style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>
            {i === 0 ? "A 원본" : "B 수정본"}
            <input
              aria-label={i === 0 ? "원본 영상 업로드" : "수정 영상 업로드"}
              type="file"
              accept="video/mp4"
              disabled={busy}
              onChange={(e) => {
                void upload(e.target.files?.[0], i);
                e.target.value = "";
              }}
              style={{ display: "block", width: "100%", marginTop: 8 }}
            />
          </label>
          {urls[i] && (
            <video
              ref={i === 0 ? a : b}
              src={urls[i]}
              controls={i === 0}
              muted={i === 1}
              playsInline
              style={{
                width: "100%",
                aspectRatio: "16/9",
                objectFit: "contain",
                background: "#161421",
                borderRadius: 12,
                touchAction: i === 1 ? "none" : "auto",
              }}
              onTimeUpdate={
                i === 0
                  ? () => {
                      if (
                        b.current &&
                        a.current &&
                        Math.abs(
                          b.current.currentTime - a.current.currentTime,
                        ) > 0.2
                      )
                        b.current.currentTime = a.current.currentTime;
                    }
                  : undefined
              }
              onPointerDown={
                i === 1
                  ? (e) => {
                      origin.current = point(e);
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }
                  : undefined
              }
              onPointerUp={i === 1 ? mark : undefined}
            />
          )}
        </View>
      ))}
      <Notice>
        원본의 재생 위치를 옮겨 비교한 다음, B 영상의 다른 부분을 드래그해서
        정답 영역을 지정해 주세요. 아래 시간 범위 안에서 누른 경우만 정답이에요.
      </Notice>
      <View style={S.row}>
        <View style={{ flex: 1 }}>
          <Field
            label="정답 시작 (초)"
            value={start}
            onChangeText={setStart}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="정답 종료 (초)"
            value={end}
            onChangeText={setEnd}
            keyboardType="decimal-pad"
          />
        </View>
      </View>
      {answers.map((r, i) => (
        <View key={i} style={S.card}>
          <Txt size={13}>
            차이 {i + 1} · {r.start}~{r.end}초 · 가로 {Math.round(r.x * 100)}%,
            세로 {Math.round(r.y * 100)}% · 영역 {Math.round(r.w * 100)}×
            {Math.round(r.h * 100)}%
          </Txt>
          <Button
            small
            secondary
            label="이 영역 삭제"
            onPress={() => setAnswers(answers.filter((_, n) => n !== i))}
          />
        </View>
      ))}
      {busy && <Notice>영상 업로드 중이에요.</Notice>}
      {error && <Notice error>{error}</Notice>}
    </View>
  );
}
