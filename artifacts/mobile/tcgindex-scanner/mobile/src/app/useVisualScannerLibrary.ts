import {useEffect, useMemo, useRef, useState} from 'react';
import {syncVisualLibrary, type VisualReady} from './visual-cache';
import {nativeVision} from './native-vision';
import type {ScannerLoadProgress} from '../scanner-load-progress';

const SYNC_INTERVAL_MS = 300000;
const RECONFIGURE_DELAY_MS = 1500;

/** Owns local catalog preparation; the camera does not depend on its progress. */
export function useVisualScannerLibrary(game: string, language: string, syncKey: number, onError: (message: string) => void, active=true) {
  const [data, setData] = useState<VisualReady>({cards: [], paths: [], status: '그림 인식 데이터를 준비하고 있어요'});
  const [ready, setReady] = useState(0);
  const [progress,setProgress]=useState<ScannerLoadProgress|null>(null);
  const configuredKey = useRef('');
  const callbacks = useRef({onError, ready});
  callbacks.current = {onError, ready};
  const cards = useMemo(() => data.cards.filter(value => value.card.game === game && (language === 'all' || value.card.language === language)), [data.cards, game, language]);
  const cardMap = useMemo(() => new Map(cards.map(value => [value.id, value.card])), [cards]);

  useEffect(() => setReady(0), [game, language]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let running = false;
    const sync = async () => {
      if (running) return;
      running = true;
      try { await syncVisualLibrary(game, controller.signal, setData, syncKey > 0,value=>{if(!controller.signal.aborted)setProgress(value);}); }
      finally { running = false; }
    };
    void sync();
    const timer = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => { clearInterval(timer); controller.abort(); };
  }, [game, syncKey, active]);

  // Price/status updates do not rebuild an identical visual index. Card IDs
  // participate in the key so a changed subset cannot reuse the wrong index.
  const ids = useMemo(() => cards.map(value => value.id), [cards]);
  const key = useMemo(() => JSON.stringify([game, language, data.paths, ids]), [game, language, data.paths, ids]);
  useEffect(() => {
    if (!active || !data.paths.length || !ids.length || configuredKey.current === key) return;
    configuredKey.current = key;
    let canceled = false;
    const timer = setTimeout(() => {
      void nativeVision.configure(data.paths, ids).then(count => {
        if (!canceled) setReady(count);
      }).catch(error => {
        if (configuredKey.current === key) configuredKey.current = '';
        if (!canceled) callbacks.current.onError(String(error));
      });
    }, callbacks.current.ready ? RECONFIGURE_DELAY_MS : 0);
    return () => {
      canceled = true;
      clearTimeout(timer);
      if (configuredKey.current === key) configuredKey.current = '';
    };
  }, [key, active]);

  return {data, cards, cardMap, ready, setReady, progress};
}
