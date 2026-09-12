import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { api, key, errorText } from "@/lib/davaq";
import type { BrandParticipation } from "@/lib/brandExchange";
import { useMediaUri } from "@/hooks/useMediaUri";
import { videoPoint } from "@/lib/brandVideoGeometry";
import { Button, Txt, Notice, S, C } from "./UI";
type Action =
  | "play"
  | "tick"
  | "pause"
  | "answer"
  | "finish"
  | "retry"
  | "abandon"
  | "keepalive";
export default function BrandVideo({
  initial,
  onComplete,
}: {
  initial: BrandParticipation;
  onComplete: () => void;
}) {
  const [p, setP] = useState(initial),
    state = useRef(initial),
    [lease, setLease] = useState(""),
    leaseRef = useRef(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [playing, setPlaying] = useState(false),
    a = useRef<HTMLVideoElement>(null),
    b = useRef<HTMLVideoElement>(null),
    working = useRef(false),
    starting = useRef(false),
    alive = useRef(true),
    playRef = useRef(false),
    pending = useRef<{ body: unknown; action: Action } | null>(null);
  const urlA = useMediaUri(initial.videoA),
    urlB = useMediaUri(initial.videoB),
    base = "/brand-exchanges/participations/" + initial.id;
  function stop() {
    playRef.current = false;
    setPlaying(false);
    a.current?.pause();
    b.current?.pause();
  }
  function position() {
    return {
      position: Math.min(30, a.current?.currentTime ?? state.current.progress),
      positionB: Math.min(30, b.current?.currentTime ?? state.current.progress),
    };
  }
  async function send(action: Action, point?: { x: number; y: number }) {
    if (working.current || !leaseRef.current) return false;
    working.current = true;
    const body = pending.current?.body ?? {
      action,
      requestKey: key(),
      lease: leaseRef.current,
      sequence: state.current.sequence + 1,
      ...position(),
      ...point,
    };
    pending.current = { body, action: pending.current?.action ?? action };
    try {
      const next = await api<BrandParticipation>(
        base + "/events",
        "POST",
        body,
      );
      pending.current = null;
      if (!alive.current) return false;
      state.current = next;
      setP(next);
      if (next.notice) setNotice(next.notice);
      if (!["held", "playing", "paused"].includes(next.status)) {
        stop();
        onComplete();
      }
      return true;
    } catch (e) {
      if (alive.current) {
        stop();
        setError(errorText(e));
      }
      return false;
    } finally {
      working.current = false;
    }
  }
  async function connect() {
    setBusy(true);
    setError("");
    stop();
    try {
      if (pending.current && leaseRef.current) {
        const retried = await send(pending.current.action);
        if (!retried) {
          pending.current = null;
          leaseRef.current = "";
          setLease("");
          return;
        }
      }
      const r = await api<{
        participation: BrandParticipation;
        lease: string | null;
      }>(base + "/lease", "POST");
      if (!alive.current) return;
      state.current = r.participation;
      setP(r.participation);
      leaseRef.current = r.lease ?? "";
      setLease(r.lease ?? "");
      pending.current = null;
      if (a.current) a.current.currentTime = r.participation.progress;
      if (b.current) b.current.currentTime = r.participation.progress;
      if (!r.lease) onComplete();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function play() {
    if (
      working.current ||
      starting.current ||
      !a.current ||
      !b.current ||
      !leaseRef.current
    )
      return;
    starting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const videos = [a.current, b.current];
    try {
      for (const v of videos) {
        v.currentTime = state.current.progress;
        v.playbackRate = 1;
      }
      // Unlock both media elements inside the click gesture, then synchronize while paused.
      await Promise.all(videos.map((v) => v.play()));
      videos.forEach((v) => v.pause());
      if (!alive.current) return;
      await Promise.all(
        videos.map(
          (v) =>
            new Promise<void>((resolve, reject) => {
              if (
                Math.abs(v.currentTime - state.current.progress) < 0.02 &&
                !v.seeking
              ) {
                resolve();
                return;
              }
              const timer = setTimeout(() => {
                v.removeEventListener("seeked", done);
                reject(new Error("seek timeout"));
              }, 8000);
              const done = () => {
                clearTimeout(timer);
                resolve();
              };
              v.addEventListener("seeked", done, { once: true });
              v.currentTime = state.current.progress;
            }),
        ),
      );
      const accepted = await send("play");
      if (!accepted || !alive.current) {
        videos.forEach((v) => v.pause());
        return;
      }
      await Promise.all(videos.map((v) => v.play()));
      if (!alive.current) {
        videos.forEach((v) => v.pause());
        return;
      }
      playRef.current = true;
      setPlaying(true);
    } catch {
      stop();
      setError(
        "동영상을 재생하지 못했어요. 네트워크를 확인하고 다시 시작해 주세요.",
      );
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }
  async function pause() {
    stop();
    if (!working.current) await send("pause");
  }
  async function finish() {
    stop();
    await send("finish");
  }
  async function retry() {
    stop();
    if (await send("retry")) {
      if (a.current) a.current.currentTime = 0;
      if (b.current) b.current.currentTime = 0;
      setNotice("두 번째 도전이에요. 재생을 눌러 시작해 주세요.");
    }
  }
  function choose(e: React.PointerEvent<HTMLVideoElement>) {
    if (!playRef.current || working.current || state.current.clicks >= 8)
      return;
    const rect = e.currentTarget.getBoundingClientRect(),
      point = videoPoint(
        e.clientX - rect.left,
        e.clientY - rect.top,
        rect.width,
        rect.height,
        e.currentTarget.videoWidth,
        e.currentTarget.videoHeight,
      );
    if (point) void send("answer", point);
  }
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => {
      if (
        !leaseRef.current ||
        working.current ||
        starting.current ||
        !["held", "playing", "paused"].includes(state.current.status) ||
        error
      )
        return;
      if (playRef.current) {
        if (!a.current || !b.current) return;
        if (
          a.current.readyState < 3 ||
          b.current.readyState < 3 ||
          document.hidden
        ) {
          void pause();
          return;
        }
        if (Math.abs(a.current.currentTime - b.current.currentTime) > 0.25) {
          void pause();
          setNotice("두 영상을 맞추고 있어요. 다시 재생해 주세요.");
          return;
        }
        if (a.current.ended && b.current.ended) void finish();
        else void send("tick");
      } else void send("keepalive");
    }, 1000);
    const hidden = () => {
      if (document.hidden) {
        stop();
        if (!working.current) void send("pause");
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
      a.current?.pause();
      b.current?.pause();
    };
  }, [error]);
  function waiting() {
    if (playRef.current) {
      stop();
      setNotice("영상이 준비되면 이어서 재생해 주세요.");
      if (!working.current) void send("pause");
    }
  }
  const done = p.progress >= 29.8;
  const style: React.CSSProperties = {
    width: "100%",
    maxHeight: 240,
    aspectRatio: "16 / 9",
    objectFit: "contain",
    background: "#14131E",
    borderRadius: 14,
    touchAction: "manipulation",
    cursor: "crosshair",
  };
  return (
    <View style={{ gap: 14 }}>
      <View style={S.between}>
        <Txt bold>
          찾은 차이 {p.found} / {p.differences}
        </Txt>
        <Txt size={13}>
          도전 {p.attempt}/2 · 선택 {p.clicks}/8
        </Txt>
      </View>
      <View style={{ height: 6, backgroundColor: C.line, borderRadius: 4 }}>
        <View
          style={{
            height: 6,
            width: ((p.progress / 30) * 100 + "%") as any,
            backgroundColor: C.purple,
            borderRadius: 4,
          }}
        />
      </View>
      <Txt size={12} color={C.muted}>
        두 영상은 동시에 재생돼요. 아래 B 영상에서 다른 부분을 눌러주세요.
      </Txt>
      <Txt bold size={13}>
        A · 원본
      </Txt>
      <video
        ref={a}
        src={urlA}
        style={style}
        playsInline
        preload="auto"
        controls={false}
        disablePictureInPicture
        onWaiting={waiting}
        onError={() => {
          stop();
          setError(
            "원본 영상을 불러오지 못했어요. 새로고침 후 다시 연결해 주세요.",
          );
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <Txt bold size={13}>
        B · 다른 부분 찾기
      </Txt>
      <video
        ref={b}
        src={urlB}
        style={style}
        playsInline
        muted
        preload="auto"
        controls={false}
        disablePictureInPicture
        onPointerDown={choose}
        onWaiting={waiting}
        onError={() => {
          stop();
          setError(
            "비교 영상을 불러오지 못했어요. 새로고침 후 다시 연결해 주세요.",
          );
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <Txt size={12} color={C.muted}>
        {Math.floor(p.progress)} / 30초 · 보상 확보 기한{" "}
        {new Date(p.expiresAt).toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Txt>
      {!lease || error ? (
        <Button
          label="참여 연결 · 이어하기"
          busy={busy}
          onPress={() => void connect()}
        />
      ) : !done ? (
        <Button
          label={playing ? "잠깐 멈추기" : "두 영상 함께 재생"}
          busy={busy}
          onPress={() => void (playing ? pause() : play())}
        />
      ) : (
        <>
          <Button label="결과 확인" onPress={() => void finish()} />
          {p.attempt < 2 && p.found < p.differences && (
            <Button
              secondary
              label="한 번 더 도전 · 약 30초 추가"
              onPress={() => void retry()}
            />
          )}
        </>
      )}
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}
      <Notice>
        끝까지 보고 모든 차이를 찾아야 성공해요. 화면을 벗어나면 영상이 멈추며,
        20분 안에는 이 화면에서 이어갈 수 있어요.
      </Notice>
      {lease && (
        <Button
          small
          secondary
          label="참여 종료 · 확보한 보상 반납"
          onPress={() => {
            stop();
            void send("abandon");
          }}
        />
      )}
    </View>
  );
}
