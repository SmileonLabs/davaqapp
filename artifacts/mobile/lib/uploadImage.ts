import type { MediaSelection } from "../components/ChatMediaPreview";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { customFetch, requestUploadUrl } from "@workspace/api-client-react";
import { prepareChatImage } from "./chatImagePreparation";
import { convertHeicIfNeeded } from "./convertHeic";

export interface UploadedImage {
  /** Canonical object path to persist in the message content (`/objects/<id>`). */
  objectPath: string;
  /** Local uri of the picked asset (useful for instant previews). */
  localUri: string;
  thumbnail?: string;
  width?: number;
  height?: number;
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class ImageTooLargeError extends Error {
  constructor() {
    super("image-too-large");
    this.name = "ImageTooLargeError";
  }
}

export class UploadCancelledError extends Error {
  constructor() {
    super("upload-cancelled");
    this.name = "UploadCancelledError";
  }
}

export type PreparedRetryImage = ImagePicker.ImagePickerAsset & {
  _chatUploadPrepared: true;
  thumbnail?: string;
};

export interface UploadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  onPrepared?: (asset: PreparedRetryImage, index: number) => void;
  onUploaded?: (image: UploadedImage, index: number, total: number) => Promise<void>;
  camera?: boolean;
  assets?: ImagePicker.ImagePickerAsset[];
  original?: boolean;
  confirmAssets?: (assets: ImagePicker.ImagePickerAsset[]) => Promise<MediaSelection | null>;
}

type ApiUploadResponse = {
  objectPath: string;
};

export class PermissionDeniedError extends Error {
  constructor() {
    super("permission-denied");
    this.name = "PermissionDeniedError";
  }
}

export function putBlob(
  uploadURL: string,
  blob: Blob,
  contentType: string,
  options: UploadOptions = {},
): Promise<void> {
  if (options.signal?.aborted) return Promise.reject(new UploadCancelledError());

  if (Platform.OS === "web") {
    options.onProgress?.(0);
    return fetch(uploadURL, {
      method: "PUT",
      body: blob,
      headers: { "Content-Type": contentType },
      signal: options.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`upload-failed-${response.status}`);
        options.onProgress?.(100);
      })
      .catch((error) => {
        if (options.signal?.aborted || error?.name === "AbortError") {
          throw new UploadCancelledError();
        }
        throw error;
      });
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();

    xhr.open("PUT", uploadURL);
    xhr.timeout = 90_000;
    xhr.ontimeout = () => {
      options.signal?.removeEventListener("abort", abort);
      reject(new Error("upload-timeout"));
    };
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      options.onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onload = () => {
      options.signal?.removeEventListener("abort", abort);
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`upload-failed-${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      options.signal?.removeEventListener("abort", abort);
      reject(new Error("upload-failed-network"));
    };
    xhr.onabort = () => {
      options.signal?.removeEventListener("abort", abort);
      reject(new UploadCancelledError());
    };

    options.signal?.addEventListener("abort", abort, { once: true });
    options.onProgress?.(0);
    xhr.send(blob);
  });
}

/**
 * Upload a blob straight to object storage via a presigned URL and return the
 * canonical object path (`/objects/<id>`). Shared by the chat image flow and
 * the profile-image crop flow.
 */
export async function uploadBlob(
  blob: Blob,
  name = `image-${Date.now()}.jpg`,
  options: UploadOptions = {},
): Promise<string> {
  const contentType = blob.type || "image/jpeg";
  const size = blob.size || 1;
  if (size > MAX_IMAGE_BYTES) throw new ImageTooLargeError();

  if (Platform.OS === "web") {
    return uploadBlobViaApi(blob, name, contentType, options);
  }

  const { uploadURL, objectPath } = await requestUploadUrl({ name, size, contentType });

  await putBlob(uploadURL, blob, contentType, options);

  return objectPath;
}

/**
 * Upload one image picker asset straight to object storage and return the stored
 * object path. Shared by single and multi-select picker flows.
 */
async function uploadImagePickerAssetAttempt(
  asset: ImagePicker.ImagePickerAsset,
  options: UploadOptions = {},
): Promise<UploadedImage> {
  const prepared = (asset as Partial<PreparedRetryImage>)._chatUploadPrepared
    ? asset as PreparedRetryImage
    : { ...await prepareChatImage(asset, options.original), _chatUploadPrepared: true as const };
  options.onPrepared?.(prepared, 0);
  asset = prepared;
  if (options.signal?.aborted) throw new UploadCancelledError();
  const rawBlob = await (await fetch(asset.uri)).blob();
  // iPhone photos are HEIC; convert to JPEG (web only) so every recipient can
  // see them. No-op for non-HEIC images and on native.
  const { blob, name, contentType } = await convertHeicIfNeeded(
    rawBlob,
    asset.fileName || `image-${Date.now()}.jpg`,
    asset.mimeType || rawBlob.type || "image/jpeg",
  );
  const size = blob.size || asset.fileSize || 1;
  if (size > MAX_IMAGE_BYTES) throw new ImageTooLargeError();

  if (Platform.OS === "web") {
    const objectPath = await uploadBlobViaApi(blob, name, contentType, options);
    return { objectPath, localUri: asset.uri, thumbnail: prepared.thumbnail, width: asset.width, height: asset.height };
  }

  const { uploadURL, objectPath } = await requestUploadUrl({ name, size, contentType });

  await putBlob(uploadURL, blob, contentType, options);

  return { objectPath, localUri: asset.uri, thumbnail: prepared.thumbnail, width: asset.width, height: asset.height };
}

// Bound each transfer separately; selecting/editing photos does not consume
// this deadline. A timeout is a retryable failure, distinct from user cancel.
async function uploadImagePickerAsset(asset: ImagePicker.ImagePickerAsset, options: UploadOptions): Promise<UploadedImage> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) throw new UploadCancelledError();
  options.signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error("image-upload-timeout")); }, 90_000);
  });
  try {
    return await Promise.race([uploadImagePickerAssetAttempt(asset, { ...options, signal: controller.signal }), deadline]);
  } catch (error) {
    if (timedOut && !options.signal?.aborted) throw new Error("image-upload-timeout");
    throw error;
  } finally {
    clearTimeout(timeout!);
    options.signal?.removeEventListener("abort", abort);
  }
}

/**
 * Open the image library, upload all chosen images straight to object storage,
 * and return their stored object paths. Returns `null` when the user cancels.
 */
export async function pickAndUploadImages(options: UploadOptions = {}): Promise<UploadedImage[] | null> {
  // Android's system Photo Picker grants access to the chosen items. Asking
  // for the whole library first would block attachment when that access is denied.
  if (!options.assets && Platform.OS !== "web" && (options.camera || Platform.OS === "ios")) {
    const perm = options.camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new PermissionDeniedError();
  }

  const picker = options.camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const result = options.assets ? { canceled: false, assets: options.assets } : await picker({
    mediaTypes: ["images"],
    quality: 1,
    selectionLimit: 10,
    allowsMultipleSelection: !options.camera,
    orderedSelection: true,
  });
  if (result.canceled || !result.assets?.length) return null;

  const selection = options.confirmAssets ? await options.confirmAssets(result.assets) : { assets: result.assets, original: options.original ?? false, caption: "" };
  if (!selection || options.signal?.aborted) return null;
  options.original = selection.original;
  const uploaded: UploadedImage[] = [];
  const total = selection.assets.length;
  for (const [index, asset] of selection.assets.entries()) {
    const aggregateOptions: UploadOptions = {
      signal: options.signal,
      original: options.original,
      onPrepared: options.onPrepared ? (prepared) => options.onPrepared?.(prepared, index) : undefined,
      onProgress: options.onProgress
        ? (progress) => {
            const aggregate = Math.round(((index + progress / 100) / total) * 100);
            options.onProgress?.(Math.min(99, aggregate));
          }
        : undefined,
    };
    const image = await uploadImagePickerAsset(asset, aggregateOptions);
    uploaded.push(image);
    await options.onUploaded?.(image, index, total);
  }

  options.onProgress?.(100);
  return uploaded;
}

/**
 * Open the image library, upload the chosen image straight to object storage
 * via a presigned URL, and return the stored object path. Returns `null` when
 * the user cancels.
 */
export async function pickAndUploadImage(options: UploadOptions = {}): Promise<UploadedImage | null> {
  const uploaded = await pickAndUploadImages(options);
  return uploaded?.[0] ?? null;
}

export async function uploadBlobViaApi(
  blob: Blob,
  name: string,
  contentType: string,
  options: UploadOptions = {},
): Promise<string> {
  if (options.signal?.aborted) throw new UploadCancelledError();

  const size = blob.size || 1;
  const params = new URLSearchParams({ name, size: String(size), contentType });
  options.onProgress?.(0);

  try {
    const response = await customFetch<ApiUploadResponse>(`/api/storage/uploads/object?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: blob,
      signal: options.signal,
      responseType: "json",
    });
    options.onProgress?.(100);
    return response.objectPath;
  } catch (error) {
    if (options.signal?.aborted || (error as { name?: string })?.name === "AbortError") {
      throw new UploadCancelledError();
    }
    throw error;
  }
}
