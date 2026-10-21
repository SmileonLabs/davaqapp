import {CallContentFrame} from './CallContentFrame';
import {useCallElapsed} from '@/hooks/useCallElapsed';
import {CallCameraPreview} from './CallCameraPreview';
import {CallAudioOutput} from './CallAudioOutput';
import {CallEndSheet,type CallOutcome} from './CallEndSheet';
import { useCallScreenAwake } from '@/hooks/useCallScreenAwake';
import { useColors } from "@/hooks/useColors";
import { FloatingCall } from "./FloatingCall";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Alert, AppState, Modal, Pressable, Text, View } from "react-native";
import { useAuth } from "@/lib/davaqAuth";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RoomEvent, type Room } from "livekit-client";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCall } from "./CallProvider";
import { IncomingCallScreen } from "./IncomingCallScreen";
import { GroupCallVideo } from "./GroupCallVideo";
import {
  joinCall,
  primeAudioPlayback,
  leaveCall,
  setMuted,
  setCameraEnabled,
  switchCamera,
  startRingtone,
  stopRingtone,
  resumeCallAudio,
  type CallMedia,
} from "@/lib/voiceCall";
import {
  registerGroupCallHandler,
  setGroupCallBusy,
} from "@/lib/groupCallActions";
import {
  reportSystemIncomingCall,
  markSystemCallActive,
  endSystemCall,
  subscribeSystemCallActions,
} from "@/lib/systemCalls";
import {
  activateGroupNative,
  endGroupNative,
  subscribeGroupNative,
} from "@/lib/groupCallNative";
import { cancelIncomingCallNotification } from "@/lib/callNotifications";
export type GroupCall = {
  id: string;
  roomId: string;
  name: string;
  creatorId: string;
  media: CallMedia;
  status: string;
  expiresAt: number;
  participants: { userId: string; name: string; state: string }[];
};
type Session = { call: GroupCall; token: string; url: string };
const request = <T,>(path: string, body?: object) =>
  customFetch<T>(`/api${path}`, {
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    responseType: "json",
  });
const Context = createContext<{
  start: (roomId: string, media: CallMedia) => Promise<void>;
  join: (id: string) => Promise<boolean>;
  busy: boolean;
}>({ start: async () => {}, join: async () => false, busy: false });
export const useGroupCall = () => useContext(Context);
export function GroupCallProvider({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const { isSignedIn, userId } = useAuth();
  const direct = useCall();
  const client = useQueryClient();
  const [active, setActive] = useState<GroupCall | null>(null);
  const [minimized, setMinimized] = useState(false);
  useEffect(() => { if (!active) setMinimized(false); }, [active]);
  const [room, setRoom] = useState<Room | null>(null);
  const [connecting, setConnecting] = useState(false);
  useCallScreenAwake(!!active || connecting);
  const [muted, updateMuted] = useState(false);
  const [camera, updateCamera] = useState(false);
  const [names, updateNames] = useState<string[]>([]);
  const [connection, setConnection] = useState("연결 중");
  const [cameraPreview,setCameraPreview]=useState<{intent:'join'|'enable';callId:string}|null>(null);
  const [cameraBusy,setCameraBusy]=useState(false);
  const cameraAction=useRef(0);
  const cameraInFlight=useRef(false);
  const [outcome,setOutcome]=useState<CallOutcome|null>(null);
  const elapsed=useCallElapsed(active?.id,!!room&&room.state==='connected');
  const elapsedRef=useRef(elapsed.seconds);elapsedRef.current=elapsed.seconds;
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const owner = useRef(userId);
  owner.current = userId;
  const activeRef = useRef(active);
  activeRef.current = active;
  const roomRef = useRef(room);
  roomRef.current = room;
  const generation = useRef(0);
  const joining = useRef(false);
  const directRef = useRef(direct.busy);
  directRef.current = direct.busy;
  const incoming = useQuery({
    queryKey: ["davaq-group-incoming", userId],
    queryFn: () => request<GroupCall[]>("/group-calls/incoming"),
    enabled: !!isSignedIn && foreground,
    refetchInterval: foreground ? 2500 : false,
  });
  const candidate =
    !active && !connecting && !direct.busy ? incoming.data?.[0] : undefined;
  const leave = async (reason='ended') => {
    const call = activeRef.current,
      target = roomRef.current;
    if(call)setOutcome({name:call.name,peerId:call.id,roomId:call.roomId,media:call.media,reason,seconds:elapsedRef.current});
    setCameraPreview(null);
    ++cameraAction.current;cameraInFlight.current=false;setCameraBusy(false);
    ++generation.current;
    joining.current = false;
    activeRef.current = null;
    roomRef.current = null;
    setActive(null);
    setRoom(null);
    setConnecting(false);
    setGroupCallBusy(false);
    stopRingtone();
    if (call) {
      void request(`/group-calls/${call.id}/leave`, {}).catch(() => {});
      void endGroupNative(call.id);
      void cancelIncomingCallNotification(call.id);
    }
    if (target) await leaveCall(target);
    client.invalidateQueries({ queryKey: ["davaq-group-incoming"] });
    client.invalidateQueries({ queryKey: ["davaq-room-group-call"] });
  };
  const connect = async (
    getSession: () => Promise<Session>,
    withCamera=false,
  ): Promise<boolean> => {
    if (
      joining.current ||
      activeRef.current ||
      directRef.current ||
      !owner.current
    ) {
      Alert.alert("통화 중", "현재 통화를 먼저 종료해 주세요.");
      return false;
    }
    setOutcome(null);
    primeAudioPlayback();
    joining.current = true;
    setGroupCallBusy(true);
    setConnecting(true);
    const current = ++generation.current,
      account = owner.current;
    let session: Session | undefined;
    let target: Room | undefined;
    try {
      session = await getSession();
      if (current !== generation.current || account !== owner.current)
        throw new Error("통화 요청이 취소됐습니다");
      stopRingtone();
      await activateGroupNative(
        session.call.id,
        session.call.name,
        session.call.roomId,
        session.call.media,
        session.call.creatorId,
      );
      await cancelIncomingCallNotification(session.call.id);
      await resumeCallAudio().catch(() => false);
      if (current !== generation.current || account !== owner.current)
        throw new Error("통화 요청이 취소됐습니다");
      const result = await joinCall(session.url, session.token, {
        callId: session.call.id,
        media: session.call.media,
        cameraEnabled: session.call.media === "video"&&withCamera,
      });
      target = result.room;
      if (current !== generation.current || account !== owner.current)
        throw new Error("통화 요청이 취소됐습니다");
      activeRef.current = session.call;
      roomRef.current = target;
      setActive(session.call);
      setRoom(target);
      updateCamera(result.cameraPublished);
      updateMuted(false);
      setConnection("통화 중");
      await activateGroupNative(
        session.call.id,
        session.call.name,
        session.call.roomId,
        session.call.media,
        session.call.creatorId,
      );
      return true;
    } catch (error) {
      if (target) await leaveCall(target);
      if (session) {
        void request(`/group-calls/${session.call.id}/leave`, {}).catch(
          () => {},
        );
        void endGroupNative(session.call.id);
      }
      if (current === generation.current) {
        activeRef.current = null;
        roomRef.current = null;
        setActive(null);
        setRoom(null);
        setGroupCallBusy(false);
        Alert.alert(
          "그룹 통화 연결 실패",
          error instanceof Error ? error.message : "다시 시도해 주세요.",
        );
      }
      return false;
    } finally {
      if (current === generation.current) {
        joining.current = false;
        setConnecting(false);
      }
      client.invalidateQueries({ queryKey: ["davaq-group-incoming"] });
    }
  };
  const join = (id: string,withCamera=false) =>
    connect(() => request<Session>(`/group-calls/${id}/join`, {}),withCamera);
  const decline = async (id: string) => {
    await request(`/group-calls/${id}/decline`, {});
    await endGroupNative(id);
    await cancelIncomingCallNotification(id);
    client.invalidateQueries({ queryKey: ["davaq-group-incoming"] });
    return true;
  };
  const handlers = useRef({ join, decline, leave });
  handlers.current = { join, decline, leave };
  useEffect(
    () =>
      registerGroupCallHandler((id, action) => handlers.current[action](id)),
    [],
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => sub.remove();
  }, []);
  useEffect(() => {
    return () => {
      ++generation.current;
      ++cameraAction.current;cameraInFlight.current=false;setCameraBusy(false);setCameraPreview(null);setOutcome(null);
      const target = roomRef.current;
      const call = activeRef.current;
      if (call) {
        void request(`/group-calls/${call.id}/leave`, {}).catch(() => {});
        void endGroupNative(call.id);
      }
      if (target) void leaveCall(target);
      activeRef.current=null;roomRef.current=null;joining.current=false;setActive(null);setRoom(null);setConnecting(false);
      setGroupCallBusy(false);
      stopRingtone();
    };
  }, [userId]);
  useEffect(() => {
    if (!candidate) return;
    startRingtone();
    void reportSystemIncomingCall({
      callId: candidate.id,
      chatRoomId: candidate.roomId,
      callerName: candidate.name,
      media: candidate.media,
      expiresAt: candidate.expiresAt,
    });
    return stopRingtone;
  }, [candidate?.id]);
  useEffect(
    () =>
      subscribeSystemCallActions((event) => {
        if (event.intent.callId !== activeRef.current?.id) return;
        if (event.action === "end") void handlers.current.leave();
        if (event.action === "audioActivated") void resumeCallAudio();
        if (event.action === "mute") {
          updateMuted(!!event.muted);
          void setMuted(!!event.muted);
        }
      }),
    [],
  );
  useEffect(() => {
    if (!active) return;
    return subscribeGroupNative(
      active.id,
      () => {
        void handlers.current.leave();
      },
      (next) => {
        void setMuted(next).then(() => updateMuted(next));
      },
    );
  }, [active?.id]);
  useEffect(() => {
    if (!room || !active) return;
    const refresh = () =>
      updateNames(
        [room.localParticipant, ...room.remoteParticipants.values()].map(
          (p) => `${p.name||"참여자"}${p.isLocal?" · 나":""}${p.isSpeaking?" · 말하는 중":""}${!p.isMicrophoneEnabled?" · 음소거":""}`,
        ),
      );
    const reconnect = () => setConnection("다시 연결 중");
    const restored = () => setConnection("통화 중");
    const disconnected = () => {
      if(roomRef.current===room)void handlers.current.leave('failed');
    };
    refresh();
    room
      .on(RoomEvent.ActiveSpeakersChanged,refresh)
      .on(RoomEvent.TrackMuted,refresh)
      .on(RoomEvent.TrackUnmuted,refresh)
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.Reconnecting, reconnect)
      .on(RoomEvent.Reconnected, restored)
      .on(RoomEvent.Disconnected, disconnected);
    const heartbeat = setInterval(() => {
      void request(`/group-calls/${active.id}/heartbeat`, {}).catch(() => {});
    }, 20000);
    return () => {
      clearInterval(heartbeat);
      room
        .off(RoomEvent.ActiveSpeakersChanged,refresh)
        .off(RoomEvent.TrackMuted,refresh)
        .off(RoomEvent.TrackUnmuted,refresh)
        .off(RoomEvent.ParticipantConnected, refresh)
        .off(RoomEvent.ParticipantDisconnected, refresh)
        .off(RoomEvent.Reconnecting, reconnect)
        .off(RoomEvent.Reconnected, restored)
        .off(RoomEvent.Disconnected, disconnected);
    };
  }, [room, active?.id]);
  const changeCamera=async(enabled?:boolean)=>{
    const target=roomRef.current;if(!target||cameraInFlight.current)return;
    const action=++cameraAction.current;cameraInFlight.current=true;setCameraBusy(true);
    try {if(enabled===undefined)await switchCamera();else{const next=await setCameraEnabled(enabled);if(action===cameraAction.current&&target===roomRef.current)updateCamera(next);}}
    catch{if(action===cameraAction.current&&target===roomRef.current)Alert.alert('카메라','카메라 설정을 바꾸지 못했어요.');}
    finally{if(action===cameraAction.current){cameraInFlight.current=false;setCameraBusy(false);}}
  };
  const cameraPreviewSurface=<CallCameraPreview embedded visible={!!cameraPreview&&((cameraPreview.intent==='join'&&candidate?.id===cameraPreview.callId)||(cameraPreview.intent==='enable'&&active?.id===cameraPreview.callId))} confirmLabel={cameraPreview?.intent==='join'?'카메라 켜고 참여':'카메라 켜기'} onCancel={()=>setCameraPreview(null)} onAudioOnly={cameraPreview?.intent==='join'?()=>{const id=cameraPreview.callId;setCameraPreview(null);void join(id,false);}:undefined} onConfirm={()=>{const pending=cameraPreview;setCameraPreview(null);if(!pending)return;if(pending.intent==='join'){void join(pending.callId,true);return;}void changeCamera(true);}}/>;
  return (
    <Context.Provider
      value={{
        start: async (roomId, media) => {
          await connect(() =>
            request<Session>(`/rooms/${roomId}/group-call`, { media }),media==='video'
          );
        },
        join,
        busy: !!active || connecting,
      }}
    >
      <CallContentFrame banner={minimized&&active&&active.media==='audio'&&<FloatingCall name={active.name??'그룹 통화'} video={false} status={`${connection} · ${elapsed.label}`} onRestore={()=>setMinimized(false)} onEnd={()=>{void leave();}}/>}>{children}</CallContentFrame>
      <IncomingCallScreen
        visible={!!candidate}
        overlay={cameraPreview?.intent==='join'?cameraPreviewSurface:undefined}
        onCloseOverlay={()=>setCameraPreview(null)}
        name={candidate?.name ?? "그룹 통화"}
        video={candidate?.media === "video"}
        onAccept={() => {
          if(candidate){if(candidate.media==='video')setCameraPreview({intent:'join',callId:candidate.id});else void join(candidate.id,false);}
        }}
        onAcceptAudio={()=>{if(candidate){setCameraPreview(null);void join(candidate.id,false);}}}
        onDecline={() => {
          if (candidate)
            void decline(candidate.id).catch(() =>
              Alert.alert("연결 오류", "다시 시도해 주세요."),
            );
        }}
      />
      {minimized && active && active.media==='video' && <FloatingCall name={active.name ?? "그룹 통화"} video={active.media === "video"} status={`${connection} · ${elapsed.label}`} onRestore={() => setMinimized(false)} onEnd={() => { void leave(); }}>{room && <GroupCallVideo room={room} compact/>}</FloatingCall>}
      <Modal
        visible={!minimized && (!!active || connecting)}
        animationType="slide"
        onRequestClose={() => { if(cameraPreview){setCameraPreview(null);return;}if (active) setMinimized(true); }}
      >
        <SafeAreaView
          style={{ flex: 1, backgroundColor: colors.background, padding: 20, gap: 20 }}
        >
          {active && <Pressable accessibilityRole="button" accessibilityLabel="통화 축소하고 채팅 보기" onPress={() => setMinimized(true)}><Text style={{ color: colors.foreground, padding: 10 }}>↙ 채팅 보기</Text></Pressable>}
          <Text style={{ color: colors.foreground, fontSize: 24 }}>
            {active?.name ?? "그룹 통화"}
          </Text>
          <Text style={{ color: colors.mutedForeground }}>
            {connection} · {elapsed.label} · {names.length}명
          </Text>
          {active?.media === "video" && room ? (
            <GroupCallVideo room={room} />
          ) : (
            <View style={{ flex: 1, justifyContent: "center" }}>
              {names.map((name, index) => (
                <Text
                  key={index}
                  style={{ color: colors.foreground, fontSize: 22, padding: 12 }}
                >
                  {name}
                </Text>
              ))}
            </View>
          )}
          {active?.media==='video'&&<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{names.map((name,index)=><Text key={index} style={{color:colors.foreground,fontSize:12}}>{name}</Text>)}</View>}
          {active&&<CallAudioOutput callId={active.id}/>}
          <View
            style={{ flexDirection: "row", flexWrap:"wrap",justifyContent: "space-around" }}
          >
            <Pressable
              accessibilityLabel="마이크 켜기/끄기"
              onPress={() => {
                const next = !muted;
                void setMuted(next)
                  .then(() => updateMuted(next))
                  .catch(() => {});
              }}
            >
              <Text style={{ color: colors.foreground, padding: 16 }}>
                {muted ? "마이크 켜기" : "음소거"}
              </Text>
            </Pressable>
            {active?.media==='video'&&<>
             <Pressable accessibilityRole="button" accessibilityLabel={camera?'카메라 끄기':'카메라 미리보기'} disabled={cameraBusy} onPress={()=>{if(cameraBusy)return;if(!camera){setCameraPreview({intent:'enable',callId:active.id});return;}void changeCamera(false);}}><Text style={{color:colors.foreground,padding:16}}>{cameraBusy?'카메라 준비 중':camera?'카메라 끄기':'카메라 켜기'}</Text></Pressable>
             {camera&&<Pressable accessibilityRole="button" accessibilityLabel="전면 후면 카메라 전환" disabled={cameraBusy} onPress={()=>{void changeCamera();}}><Text style={{color:colors.foreground,padding:16}}>카메라 전환</Text></Pressable>}
            </>}

            <Pressable
              onPress={() => {
                void leave();
              }}
              style={{ backgroundColor: "#D63A60", borderRadius: 20 }}
            >
              <Text style={{ color: colors.foreground, padding: 16 }}>나가기</Text>
            </Pressable>
          </View>
          {cameraPreview?.intent==='enable'&&cameraPreviewSurface}
        </SafeAreaView>
      </Modal>

      <CallEndSheet outcome={isSignedIn&&!active&&!connecting?outcome:null} onClose={()=>setOutcome(null)} retryLabel="다시 참여하기" onRetry={()=>{const previous=outcome;setOutcome(null);if(!previous)return;const current=generation.current;const account=owner.current;const until=Date.now()+1500;setTimeout(()=>{if(current===generation.current&&account===owner.current&&AppState.currentState==='active'&&Date.now()<until)void join(previous.peerId,false);},250);}}/>
    </Context.Provider>
  );
}
export function RoomGroupCallBanner({ roomId }: { roomId: string }) {
  const colors = useColors();
  const group = useGroupCall();
  const query = useQuery({
    queryKey: ["davaq-room-group-call", roomId],
    queryFn: () => request<GroupCall | null>(`/rooms/${roomId}/group-call`),
    refetchInterval: 5000,
  });
  if (!query.data) return null;
  const call = query.data;
  return (
    <Pressable
      disabled={group.busy}
      onPress={() => {
        void group.join(call.id);
      }}
      style={{ backgroundColor: colors.secondary, padding: 14 }}
    >
      <Text style={{ color: colors.primary }}>
        {call.media === "video" ? "그룹 영상통화" : "그룹 보이스톡"} 진행 중 ·
        참여하기
      </Text>
    </Pressable>
  );
}
