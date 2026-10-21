import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import type {CameraRef} from 'react-native-vision-camera';
import {applyCameraZoom, isInactiveCameraError, isRecoverableCameraError} from '../camera-control';
import {nativeVision} from './native-vision';

const MAX_RECONNECTIONS = 2;
const RECONNECT_DELAY_MS = 600;
const FRAME_TIMEOUT_MS = 8000;

/** Camera lifecycle is independent of catalog downloads and recognition results. */
export function useScannerCameraSession(photoPath: string, zoom: number, onError: (message: string) => void, prepared = true) {
  const camera = useRef<CameraRef>(null);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [streaming, setStreaming] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [key, setKey] = useState(0);
  const [status, setStatus] = useState('');
  const recovery = useRef({
    attempts: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    frameAt: Date.now(),
    frames: 0,
  });
  const current = useRef({active, photoPath, mounted, onError, prepared});
  current.current = {active, photoPath, mounted, onError, prepared};

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => listener.remove();
  }, []);

  // Foregrounding may resume frames without another preview-start callback.
  useEffect(() => {
    nativeVision.setEnabled(active && mounted && !photoPath && prepared);
    return () => nativeVision.setEnabled(false);
  }, [active, mounted, photoPath, prepared]);

  const reconnect = useCallback(() => {
    const state = recovery.current;
    if (!current.current.active || !current.current.prepared || current.current.photoPath || state.timer) return;
    setStreaming(false);
    setMounted(false);
    nativeVision.setEnabled(false);
    if (state.attempts >= MAX_RECONNECTIONS) {
      setStatus('카메라를 다시 시작하지 못했어요. 카메라 접근 설정을 확인한 뒤 다시 시도해 주세요.');
      return;
    }
    state.attempts++;
    setStatus('카메라를 다시 연결하고 있어요');
    state.timer = setTimeout(() => {
      state.timer = undefined;
      if (AppState.currentState === 'active' && !current.current.photoPath) {
        state.frameAt = Date.now();
        state.frames = 0;
        setKey(value => value + 1);
        setMounted(true);
      }
    }, RECONNECT_DELAY_MS);
  }, []);

  useEffect(() => {
    const state = recovery.current;
    if (active && prepared && !photoPath) {
      state.frameAt = Date.now();
      state.frames = 0;
    }
    if (active && prepared && !photoPath && !mounted && !state.timer) reconnect();
    const timer = setInterval(() => {
      const session = current.current;
      if (session.active && session.prepared && !session.photoPath && session.mounted && Date.now() - state.frameAt > FRAME_TIMEOUT_MS) reconnect();
    }, 1000);
    return () => clearInterval(timer);
  }, [active, photoPath, mounted, prepared, reconnect]);

  useEffect(() => () => {
    if (recovery.current.timer) clearTimeout(recovery.current.timer);
  }, []);

  const receiveFrames = useCallback((frames: number) => {
    const state = recovery.current;
    // Replacing a complete local index resets the native frame counter. A
    // lower positive counter is fresh progress, rather than a frozen camera.
    if (current.current.photoPath || frames < 1 || frames === state.frames) return;
    state.frames = frames;
    state.frameAt = Date.now();
    state.attempts = 0;
    setStreaming(true);
    setStatus('');
  }, []);

  const onStarted = useCallback(() => {
    recovery.current.frameAt = Date.now();
    recovery.current.frames = 0;
    setStreaming(true);
  }, []);
  const onStopped = useCallback(() => setStreaming(false), []);
  const onCameraError = useCallback((error: {message: string}) => {
    if (isRecoverableCameraError(error)) reconnect();
    else if (!isInactiveCameraError(error)) current.current.onError(error.message.split('\n')[0]);
  }, [reconnect]);
  const retry = useCallback(() => {
    recovery.current.attempts = 0;
    reconnect();
  }, [reconnect]);

  useEffect(() => {
    if (!active || !streaming || photoPath) return;
    let canceled = false;
    void applyCameraZoom(camera.current?.controller, zoom, () => !canceled && AppState.currentState === 'active')
      .catch(error => current.current.onError(String(error).split('\n')[0]));
    return () => { canceled = true; };
  }, [active, streaming, zoom, photoPath]);

  return {camera, active, mounted: mounted && prepared, key, status, canRetry: !mounted && !recovery.current.timer, receiveFrames, onStarted, onStopped, onCameraError, retry};
}
