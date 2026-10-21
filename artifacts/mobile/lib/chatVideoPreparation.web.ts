import type { ImagePickerAsset } from "expo-image-picker";
import { UploadCancelledError } from "./uploadImage";
/** Browser videos retain their source codec; native clients provide automatic compression. */
export async function prepareChatVideo(asset: ImagePickerAsset, _original = false, signal?: AbortSignal, _onProgress?: (value: number) => void) {
  if (signal?.aborted) throw new UploadCancelledError();
  let thumbnail: string | undefined;
  const video = document.createElement("video");
  video.muted = true; video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error("poster-timeout")), 10000);
      const abort = () => finish(new UploadCancelledError());
      const finish = (error?: Error) => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); video.onloadeddata = null; video.onerror = null; error ? reject(error) : resolve(); };
      signal?.addEventListener("abort", abort, { once: true });
      video.onloadeddata = () => finish(); video.onerror = () => finish(new Error("poster-unavailable")); video.src = asset.uri;
    });
    const ratio = Math.min(1, 160 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1,Math.round(video.videoWidth*ratio)); canvas.height = Math.max(1,Math.round(video.videoHeight*ratio));
    canvas.getContext("2d")?.drawImage(video,0,0,canvas.width,canvas.height); const encoded = canvas.toDataURL("image/jpeg",0.45); if (encoded.length < 10000) thumbnail = encoded;
  } catch { if (signal?.aborted) throw new UploadCancelledError(); }
  finally { video.removeAttribute("src"); video.load(); }
  return { uri: asset.uri, thumbnail, durationSec: asset.duration ? asset.duration / 1000 : undefined, compressed: false };
}
