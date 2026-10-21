import { removeGeneratedMedia } from "./chatUploadTemp";
import { Video, createVideoThumbnail } from "react-native-compressor";
import * as ImageManipulator from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";
import { UploadCancelledError } from "./uploadImage";
export async function prepareChatVideo(asset: ImagePickerAsset, original = false, signal?: AbortSignal, onProgress?: (value: number) => void) {
  let id: string | undefined;
  const cancel = () => { if (id) Video.cancelCompression(id); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (signal?.aborted) throw new UploadCancelledError();
    const uri = original ? asset.uri : await Video.compress(asset.uri, { compressionMethod: "auto", maxSize: 1280, minimumFileSizeForCompress: 2, getCancellationId: value => { id = value; if (signal?.aborted) cancel(); } }, progress => onProgress?.(Math.round(progress * 30)));
    if (signal?.aborted) throw new UploadCancelledError();
    let thumbnail: string | undefined;
    let posterPath: string | undefined, previewPath: string | undefined;
    try {
      const poster = await createVideoThumbnail(uri);
      posterPath = poster.path;
      const ratio = Math.min(1, 160 / Math.max(poster.width, poster.height));
      const image = await ImageManipulator.manipulateAsync(poster.path, [{resize:{width:Math.max(1,Math.round(poster.width*ratio)),height:Math.max(1,Math.round(poster.height*ratio))}}], { compress: 0.45, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      previewPath = image.uri;
      if (image.base64 && image.base64.length < 9500) thumbnail = `data:image/jpeg;base64,${image.base64}`;
    } catch { /* Playback remains available if a codec cannot supply a poster. */ }
    finally { if(posterPath) await removeGeneratedMedia(posterPath); if(previewPath && previewPath !== posterPath) await removeGeneratedMedia(previewPath); }
    return { uri, thumbnail, durationSec: asset.duration ? asset.duration / 1000 : undefined, compressed: uri !== asset.uri };
  } catch (error) { if (signal?.aborted) throw new UploadCancelledError(); throw error; }
  finally { signal?.removeEventListener("abort", cancel); }
}
