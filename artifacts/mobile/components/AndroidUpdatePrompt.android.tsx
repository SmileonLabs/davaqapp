import { useEffect, useRef } from 'react';
import { Alert, AppState, Linking, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { useCall } from './CallProvider';
import { useGroupCall } from './GroupCallProvider';
import { shouldOfferAndroidUpdate, UPDATE_REMINDER_DELAY, type DeferredUpdate } from '@/lib/androidUpdatePolicy';

const DEFERRED_KEY = 'davaq.android-update-reminder.v1';
const STORE_URL = 'https://play.google.com/store/apps/details?id=app.davaq.mobile';
export function AndroidUpdatePrompt() {
  const direct = useCall(), group = useGroupCall();
  const busy = useRef(false); busy.current = direct.busy || group.busy;
  useEffect(() => {
    const bridge = NativeModules.DavaqPlayUpdate as { check?: () => Promise<{available: boolean; versionCode: number}> } | undefined;
    if (!bridge?.check) return;
    let disposed=false, checking=false, showing=false, nextCheck=0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const installed=Number(Application.nativeBuildVersion);
    const check=async () => {
      if (disposed || checking || showing || busy.current || AppState.currentState !== 'active' || Date.now()<nextCheck) return;
      checking=true; nextCheck=Date.now()+60_000;
      try {
        const info=await Promise.race([bridge.check!(),new Promise<never>((_,reject)=>{ timeout=setTimeout(()=>reject(Error('timeout')),10_000); })]);
        const raw=await AsyncStorage.getItem(DEFERRED_KEY);
        let deferred: DeferredUpdate | null=null;
        try { deferred=raw ? JSON.parse(raw) : null; } catch {}
        nextCheck=Date.now()+5*60_000;
        if (disposed || busy.current || AppState.currentState!=='active' || !shouldOfferAndroidUpdate(info,installed,deferred,Date.now())) return;
        showing=true;
        const defer=()=>{ showing=false; void AsyncStorage.setItem(DEFERRED_KEY,JSON.stringify({versionCode:info.versionCode,until:Date.now()+UPDATE_REMINDER_DELAY})).catch(()=>{}); };
        Alert.alert('새 버전이 있어요','더 나은 채팅과 통화 경험을 위해 DavaQ를 업데이트해 주세요.',[
          {text:'나중에',style:'cancel',onPress:defer},
          {text:'업데이트',onPress:()=>{ defer(); void Linking.openURL('market://details?id=app.davaq.mobile').catch(()=>Linking.openURL(STORE_URL)).catch(()=>Alert.alert('스토어를 열 수 없어요','Play 스토어에서 DavaQ를 검색해 업데이트해 주세요.')); }},
        ],{cancelable:true,onDismiss:defer});
      } catch { /* Offline, sideloaded or Play unavailable: never block app use. */ }
      finally { if(timeout) clearTimeout(timeout); timeout=undefined; checking=false; }
    };
    void check();
    const listener=AppState.addEventListener('change',state=>{ if(state==='active') void check(); });
    const timer=setInterval(()=>void check(),60_000);
    return ()=>{ disposed=true; listener.remove(); clearInterval(timer); if(timeout) clearTimeout(timeout); };
  },[]);
  return null;
}
