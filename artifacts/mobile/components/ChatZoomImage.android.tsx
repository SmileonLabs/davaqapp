import React, { useMemo } from "react";
import { ChatCachedImage } from "./ChatCachedImage";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
export function ChatZoomImage({ uri, thumbnail, width, onZoom }: { uri?: string; thumbnail?: string; width: number; onZoom: (zoomed: boolean) => void }) {
  const scale = useSharedValue(1), saved = useSharedValue(1), x = useSharedValue(0), y = useSharedValue(0), startX = useSharedValue(0), startY = useSharedValue(0);
  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch().onBegin(() => runOnJS(onZoom)(true)).onUpdate(event => { scale.value = Math.max(1, Math.min(4, saved.value * event.scale)); }).onEnd(() => { saved.value = scale.value; if (scale.value <= 1) { x.value = 0; y.value = 0; } runOnJS(onZoom)(scale.value > 1); });
    const pan = Gesture.Pan().manualActivation(true).onTouchesDown((_, manager) => { if (scale.value > 1) manager.activate(); else manager.fail(); }).onStart(() => { startX.value = x.value; startY.value = y.value; }).onUpdate(event => { const limit = width * (scale.value - 1) / 2; x.value = Math.max(-limit,Math.min(limit,startX.value+event.translationX)); y.value = Math.max(-limit,Math.min(limit,startY.value+event.translationY)); });
    const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => { const next = scale.value > 1 ? 1 : 2; scale.value = withTiming(next,{duration:140}); saved.value = next; x.value = 0; y.value = 0; runOnJS(onZoom)(next > 1); });
    return Gesture.Simultaneous(pinch,pan,doubleTap);
  }, [onZoom, saved, scale, x, y, startX, startY, width]);
  const transform = useAnimatedStyle(() => ({ transform: [{translateX:x.value},{translateY:y.value},{scale:scale.value}] }));
  return <GestureDetector gesture={gesture}><Animated.View style={{ width, flex:1, overflow:"hidden" }}><Animated.View style={[{flex:1},transform]}><ChatCachedImage objectPath={uri} thumbnail={thumbnail} contentFit="contain" style={{ flex:1, width }} accessibilityLabel="확대한 사진" /></Animated.View></Animated.View></GestureDetector>;
}
