import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@/lib/davaqAuth';
import { resolveMediaUri } from './useMediaUri';
import { acquireBrowserPhoto, setBrowserMediaOwner, peekBrowserPhoto, invalidateBrowserPhoto } from '@/lib/chatBrowserMediaCache';
export function useBrowserChatPhoto(path?: string, retryKey = 0) {
  const { userId } = useAuth();
  const identity = `${userId}:${path}:${retryKey}`;
  const [state, setState] = useState<{ identity: string; uri?: string; error?: unknown }>();
  useEffect(() => {
    if (Platform.OS !== 'web' || !userId || !path) return;
    setBrowserMediaOwner(userId);
    let active = true;
    let release: (() => void) | undefined;
    void (async () => { if (retryKey > 0) await invalidateBrowserPhoto(userId, path); return acquireBrowserPhoto(userId, path, () => resolveMediaUri(path)); })().then(image => {
      if (!active) { image.release(); return; }
      release = image.release; setState({ identity, uri: image.uri });
    }).catch(error => { if (active) setState({ identity, error }); });
    return () => { active = false; release?.(); };
  }, [identity]);
  if (state?.identity === identity) return state;
  const cached = retryKey === 0 && Platform.OS === 'web' && userId && path ? peekBrowserPhoto(userId, path) : undefined;
  return cached ? { identity, uri: cached } : undefined;
}
