import { useEffect, useId, useMemo } from 'react';
import { AppState, Platform } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake, isAvailableAsync } from 'expo-keep-awake';
import { createCallScreenAwakeController } from '@/lib/callScreenAwake';

export function useCallScreenAwake(enabled: boolean) {
  const id = useId();
  const controller = useMemo(() => createCallScreenAwakeController({
    available: isAvailableAsync,
    activate: activateKeepAwakeAsync,
    deactivate: deactivateKeepAwake,
  }, `davaq-call-screen-${id}`), [id]);

  useEffect(() => {
    const sync = () => {
      const visible = Platform.OS !== 'web' || typeof document === 'undefined' || document.visibilityState === 'visible';
      void controller.setActive(enabled && AppState.currentState === 'active' && visible);
    };
    sync();
    const subscription = AppState.addEventListener('change', sync);
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', sync);
    return () => {
      subscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', sync);
      void controller.setActive(false);
    };
  }, [controller, enabled]);
}
