import { removeGeneratedMedia } from "./chatUploadTemp";
import { prepareChatVideo } from "./chatVideoPreparation";
import { requestRecordingPermissionsAsync } from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";
import { requestUploadUrl } from "@workspace/api-client-react";
import { putBlob, uploadBlobViaApi, type UploadOptions } from "./uploadImage";

export interface UploadedFile {
  /** Canonical object path to persist (`/objects/<id>`). */
  objectPath: string;
  /** Original filename for display/download. */
  name: string;
  /** Size in bytes (0 when unknown). */
  size: number;
  /** Best-effort MIME type. */
  mimeType: string;
  thumbnail?: string;
  durationSec?: number;
  caption?: string;
}

/** Files are capped larger than images since they may be documents/archives. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB

export class FileTooLargeError extends Error {
  constructor() {
    super("file-too-large");
    this.name = "FileTooLargeError";
  }
}

export async function uploadFileBlob(
  blob: Blob,
  name = `file-${Date.now()}`,
  mimeType = blob.type || "application/octet-stream",
  options: UploadOptions = {},
): Promise<UploadedFile> {
  const size = blob.size ?? 0;
  if (size > MAX_FILE_BYTES) throw new FileTooLargeError();

  if (Platform.OS === "web") {
    const objectPath = await uploadBlobViaApi(blob, name, mimeType, options);
    return { objectPath, name, size, mimeType };
  }

  const { uploadURL, objectPath } = await requestUploadUrl({
    name,
    size: size || 1,
    contentType: mimeType,
  });

  await putBlob(uploadURL, blob, mimeType, options);

  return { objectPath, name, size, mimeType };
}

/**
 * Open the system document picker, upload the chosen file straight to object
 * storage via a presigned URL, and return its canonical object path plus the
 * original filename/size for display. Returns `null` when the user cancels.
 */
export async function pickAndUploadFile(options: UploadOptions = {}): Promise<UploadedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const blob = await (await fetch(asset.uri)).blob();
  const size = asset.size ?? blob.size ?? 0;
  if (size > MAX_FILE_BYTES) throw new FileTooLargeError();

  const mimeType = asset.mimeType || blob.type || "application/octet-stream";
  const name = asset.name || `file-${Date.now()}`;
  return uploadFileBlob(blob, name, mimeType, options);
}

/** Camera clips and library videos use the same authorized file-message transport. */
export async function pickAndUploadVideo(camera: boolean, options: UploadOptions = {}): Promise<UploadedFile | null> {
  // The Android system picker grants selected video access without library permission.
  if (Platform.OS !== "web" && (camera || Platform.OS === "ios")) {
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new Error("video-permission-denied");
    if (camera && !(await requestRecordingPermissionsAsync()).granted) throw new Error("video-permission-denied");
  }
  const picker = camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const result = await picker({ mediaTypes: ["videos"], videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium });
  if (result.canceled || !result.assets?.length) return null;
  const selection = options.confirmAssets ? await options.confirmAssets(result.assets) : { assets: result.assets, original: false, caption: "" };
  if (!selection || options.signal?.aborted) return null;
  const asset = selection.assets[0];
  const prepared = await prepareChatVideo(asset, selection.original, options.signal, options.onProgress);
  try {
  const blob = await (await fetch(prepared.uri)).blob();
  const uploaded = await uploadFileBlob(blob, prepared.compressed ? `video-${Date.now()}.mp4` : asset.fileName ?? `video-${Date.now()}.mp4`, prepared.compressed ? "video/mp4" : asset.mimeType || blob.type || "video/mp4", { ...options, onProgress: value => options.onProgress?.(30 + Math.round(value * 0.7)) });
  return { ...uploaded, thumbnail: prepared.thumbnail, durationSec: prepared.durationSec, caption: selection.caption };
  } finally { if(prepared.compressed) await removeGeneratedMedia(prepared.uri); }
}
