import { setBrowserMediaOwner } from '@/lib/chatBrowserMediaCache';
import { pruneChatUploadPreviews } from "@/lib/chatUploadTemp";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { useAuth } from "@/lib/davaqAuth";
import { Image } from "expo-image";
import { clearChatVideoCache, setChatMediaOwner } from "@/lib/chatVideoCache";
import AsyncStorage from "@react-native-async-storage/async-storage";
let queue: Promise<unknown> = Promise.resolve();
export function ChatMediaCacheLifecycle() {
  const { isLoaded, userId } = useAuth();
  useEffect(() => {
    if (!isLoaded) return;
    if (Platform.OS === "web") { setBrowserMediaOwner(userId ?? undefined); return; }
    queue = queue.catch(()=>{}).then(async () => {
      const previous = await AsyncStorage.getItem('davaq-media-cache-owner');
      const owner = userId ?? '';
      if (previous !== owner) {
        await Image.clearMemoryCache(); await Image.clearDiskCache(); await clearChatVideoCache();
        await AsyncStorage.setItem('davaq-media-cache-owner',owner);
      }
      await setChatMediaOwner(userId ?? undefined);
      await pruneChatUploadPreviews();
    });
    void queue.catch(()=>{});
  },[isLoaded,userId]);
  return null;
}
