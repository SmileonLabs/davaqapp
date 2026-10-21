export const UPDATE_REMINDER_DELAY = 24 * 60 * 60 * 1000;
export type DeferredUpdate = { versionCode: number; until: number };
export function shouldOfferAndroidUpdate(info: { available: boolean; versionCode: number }, installed: number, deferred: DeferredUpdate | null, now: number) {
  return info.available && Number.isInteger(info.versionCode) && info.versionCode > installed &&
    !(deferred?.versionCode === info.versionCode && deferred.until > now);
}
