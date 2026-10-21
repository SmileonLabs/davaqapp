import { retainChatUploadPreview, removeGeneratedMedia } from "./chatUploadTemp";
import * as ImageManipulator from "expo-image-manipulator";
import { Image, Platform } from "react-native";
import type { ImagePickerAsset } from "expo-image-picker";
import { convertHeicIfNeeded } from "./convertHeic";

/** Decode HEIC and resize before uploading. Small JPEG previews travel with the message. */
export async function prepareChatImage(asset: ImagePickerAsset, original = false) {
  let inputUri = asset.uri;
  let temporaryUri: string | undefined;
  const heic = /hei[cf]/i.test(asset.mimeType ?? "") || /\.hei[cf]$/i.test(asset.fileName ?? "");
  try {
    if (Platform.OS === "web" && heic) {
      const raw = await (await fetch(asset.uri)).blob();
      const converted = await convertHeicIfNeeded(raw, asset.fileName ?? "photo.heic", asset.mimeType ?? "image/heic");
      temporaryUri = URL.createObjectURL(converted.blob);
      inputUri = temporaryUri;
    }
    const dimensions = asset.width > 0 && asset.height > 0 ? asset : await new Promise<{ width: number; height: number }>((resolve, reject) => Image.getSize(inputUri, (width, height) => resolve({width,height}), reject));
    const animated = asset.mimeType === "image/gif";
    const ratio = Math.min(1, 2048 / Math.max(dimensions.width, dimensions.height));
    const actions = !original && ratio < 1 ? [{ resize: { width: Math.max(1, Math.round(dimensions.width * ratio)), height: Math.max(1, Math.round(dimensions.height * ratio)) } }] : [];
    const main = (original || animated) && !temporaryUri ? { ...asset, ...dimensions } : await ImageManipulator.manipulateAsync(inputUri, actions, {
      compress: original ? 1 : 0.78, format: ImageManipulator.SaveFormat.JPEG,
    });
    const previewRatio = Math.min(1, 160 / Math.max(dimensions.width, dimensions.height));
    let thumbnail: string | undefined;
    try {
      const preview = await ImageManipulator.manipulateAsync(inputUri, [{ resize: { width: Math.max(1, Math.round(dimensions.width * previewRatio)), height: Math.max(1, Math.round(dimensions.height * previewRatio)) } }], {
        compress: 0.45, format: ImageManipulator.SaveFormat.JPEG, base64: true,
      });
      if (preview.base64 && preview.base64.length < 9500) thumbnail = `data:image/jpeg;base64,${preview.base64}`;
      if (preview.uri !== inputUri && preview.uri !== main.uri) await removeGeneratedMedia(preview.uri);
    } catch { /* A missing preview must not block a supported original/animated file. */ }
    const jpeg = Boolean(temporaryUri) || (!original && !animated);
    const retainedUri = main.uri !== asset.uri ? await retainChatUploadPreview(main.uri) : main.uri;
    return { ...asset, uri: retainedUri, width: main.width, height: main.height,
      fileName: jpeg ? `photo-${Date.now()}.jpg` : asset.fileName,
      mimeType: jpeg ? "image/jpeg" : asset.mimeType, thumbnail };
  } finally { if (temporaryUri) URL.revokeObjectURL(temporaryUri); }
}
