import React, { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  getFetchRoomMessagesQueryKey,
  type Message,
} from "@workspace/api-client-react";
import { crossAlert } from "@/lib/crossAlert";
import { encodeFileContent } from "@/lib/fileMessage";
import {
  dragEventHasFiles,
  isImageTransferFile,
  replyPreviewFromMessage,
  uploadFileName,
} from "@/lib/chatScreenUtils";
import {
  ImageTooLargeError,
  PermissionDeniedError,
  pickAndUploadImages,
  UploadCancelledError,
  uploadBlob,
} from "@/lib/uploadImage";
import {
  FileTooLargeError,
  pickAndUploadFile,
  uploadFileBlob,
  type UploadedFile,
} from "@/lib/uploadFile";
import { sendChatMessage as sendMessageRequest } from "@/lib/chatTransport";
import {
  canRetryChatOutboxEntry,
  ChatOutboxCapacityError,
  ChatSendOwnerFence,
  isRetryableChatDeliveryError,
  markChatOutboxAttempt,
  markChatOutboxFailure,
  type ChatOutboxEntry,
  type ChatSendOwnerToken,
} from "@/lib/chatOutboxPolicy";
import {
  loadChatOutbox,
  removeChatOutboxEntry,
  tryAcquireChatOutboxDelivery,
  upsertChatOutboxEntry,
} from "@/lib/chatMessageOutbox";
import { mergeChatMessages } from "@/lib/chatMessageReliability";
import {
  noteChatMessageAck,
  noteChatPending,
  noteChatResource,
} from "@/lib/chatPerformanceDiagnostics";

type UploadTask = {
  kind: "image" | "file";
  progress: number | null;
  controller: AbortController;
};

type SendableMessageType = "text" | "sticker" | "image" | "file";

function newClientMessageId(): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `m-${randomId}`;
}

export function useChatSendHandlers({
  roomId,
  me,
  senderProfile,
  replyTo,
  clearReply,
  clientKeyRef,
  forceStickToBottom,
  isDungeon,
  beginDungeonThinking,
  clearDungeonThinking,
}: {
  roomId: string;
  me: { id?: string } | null | undefined;
  senderProfile?: {
    id: string;
    type: string;
    handle: string;
    displayName: string;
    profileImageUrl: string | null;
  } | null;
  replyTo: Message | null;
  clearReply: () => void;
  clientKeyRef: React.MutableRefObject<Map<string, string>>;
  forceStickToBottom: () => void;
  isDungeon: boolean;
  beginDungeonThinking: () => void;
  clearDungeonThinking: () => void;
}) {
  const queryClient = useQueryClient();
  const [uploadTask, setUploadTask] = useState<UploadTask | null>(null);
  const [isWebDraggingUpload, setIsWebDraggingUpload] = useState(false);
  const dragDepthRef = useRef(0);
  const inFlightRef = useRef(new Map<string, AbortController>());
  const flushInProgressRef = useRef(new Set<string>());
  const hasRoomOutboxRef = useRef(false);
  const terminalCallbacksRef = useRef(new Map<string, () => void>());
  const uploadControllerRef = useRef<AbortController | null>(null);
  const ownerFenceRef = useRef(new ChatSendOwnerFence());
  const ownerScopeKey = `${me?.id ?? ""}\u0000${senderProfile?.id ?? ""}\u0000${roomId}`;
  // Updating a ref during render is deliberate: stale async continuations are
  // fenced immediately, before effects from the previous owner are cleaned up.
  ownerFenceRef.current.setOwner(
    me?.id ?? null,
    senderProfile?.id ?? null,
    roomId || null,
  );

  useEffect(() => {
    const ownerToken = ownerFenceRef.current.capture();
    return () => ownerFenceRef.current.invalidate(ownerToken);
  }, [ownerScopeKey]);

  const updateOptimisticDeliveryState = React.useCallback(
    (entry: ChatOutboxEntry) => {
      const key = getFetchRoomMessagesQueryKey(entry.roomId);
      queryClient.setQueryData<Message[]>(key, (old = []) =>
        old.map((message) =>
          message.id === entry.tempId || message.clientMessageId === entry.clientMessageId
            ? ({ ...message, _deliveryState: entry.deliveryState } as Message)
            : message,
        ),
      );
    },
    [queryClient],
  );

  const replaceOptimisticMessage = React.useCallback(
    (key: ReturnType<typeof getFetchRoomMessagesQueryKey>, created: Message) => {
      queryClient.setQueryData<Message[]>(key, (old = []) =>
        mergeChatMessages(old, [created]) as Message[],
      );
    },
    [queryClient],
  );

  const deliverEntry = React.useCallback(
    async (
      entry: ChatOutboxEntry,
      ownerToken: ChatSendOwnerToken,
    ): Promise<void> => {
      if (!ownerFenceRef.current.matchesEntry(ownerToken, entry)) return;
      const inFlightKey = `${ownerToken.ownerId}\u0000${entry.clientMessageId}`;
      if (inFlightRef.current.has(inFlightKey)) return;
      if (
        Platform.OS === "web" &&
        typeof navigator !== "undefined" &&
        navigator.onLine === false
      ) {
        return;
      }
      const releaseDelivery = tryAcquireChatOutboxDelivery(
        entry.senderId,
        entry.clientMessageId,
      );
      if (!releaseDelivery) return;

      const attempted = markChatOutboxAttempt(entry, Date.now());
      const controller = new AbortController();
      inFlightRef.current.set(inFlightKey, controller);
      noteChatPending("messageSend", 1);
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        try {
          await upsertChatOutboxEntry(entry.senderId, attempted);
          if (!ownerFenceRef.current.matchesEntry(ownerToken, entry)) return;
          updateOptimisticDeliveryState(attempted);
        } catch {
          // The original durable entry is still present. Leave it untouched so
          // a later foreground/reconnect flush can attempt again.
          return;
        }

        let created: Message;
        try {
          if (!ownerFenceRef.current.matchesEntry(ownerToken, entry)) return;
          created = await sendMessageRequest(
            entry.roomId,
            {
              content: entry.content,
              type: entry.type,
              replyToMessageId: entry.replyToMessageId,
              clientMessageId: entry.clientMessageId,
            },
            {
              signal: controller.signal,
              // Keep one correlation ID across timeout/retry cycles. Server
              // request logs can now trace the same logical message without
              // including content or an auth token.
              headers: {
                "x-request-id": entry.clientMessageId,
                ...(entry.senderProfileId
                  ? { "x-character-profile-id": entry.senderProfileId }
                  : {}),
              },
            },
          );
        } catch (error) {
          if (!ownerFenceRef.current.matchesEntry(ownerToken, entry)) return;
          const retryable = isRetryableChatDeliveryError(error);
          const failed = markChatOutboxFailure(attempted, Date.now(), retryable);
          try {
            await upsertChatOutboxEntry(entry.senderId, failed);
          } catch {
            // Keep the previous durable entry if updating retry metadata fails.
          }
          if (!ownerFenceRef.current.matchesEntry(ownerToken, entry)) return;
          updateOptimisticDeliveryState(failed);
          if (failed.deliveryState === "failed") {
            terminalCallbacksRef.current.get(entry.clientMessageId)?.();
            terminalCallbacksRef.current.delete(entry.clientMessageId);
          }
          return;
        }

        if (!ownerFenceRef.current.matchesEntry(ownerToken, entry)) return;
        if (created?.id) clientKeyRef.current.set(created.id, entry.tempId);
        if (created) {
          noteChatMessageAck(entry.createdAt);
          replaceOptimisticMessage(
            getFetchRoomMessagesQueryKey(entry.roomId),
            created,
          );
        }
        // Cache acknowledgement first. If local deletion fails, the next flush
        // sees the confirmed operation ID and removes the stale outbox row
        // without sending it again.
        try {
          await removeChatOutboxEntry(entry.senderId, entry.clientMessageId);
        } catch {
          // Best-effort cleanup; server idempotency still makes a retry safe.
        }
        if (ownerFenceRef.current.matchesEntry(ownerToken, entry)) {
          terminalCallbacksRef.current.delete(entry.clientMessageId);
        }
      } finally {
        clearTimeout(timeout);
        if (inFlightRef.current.get(inFlightKey) === controller) {
          inFlightRef.current.delete(inFlightKey);
        }
        noteChatPending("messageSend", -1);
        releaseDelivery();
      }
    },
    [clientKeyRef, replaceOptimisticMessage, updateOptimisticDeliveryState],
  );

  const flushRoomOutbox = React.useCallback(async (): Promise<void> => {
    const ownerToken = ownerFenceRef.current.capture();
    if (!ownerToken) return;
    const senderId = ownerToken.ownerId;
    const flushKey = `${ownerToken.ownerId}\u0000${ownerToken.profileId}\u0000${ownerToken.generation}`;
    if (flushInProgressRef.current.has(flushKey)) return;
    if (
      Platform.OS === "web" &&
      (typeof document === "undefined" ||
        document.visibilityState !== "visible" ||
        navigator.onLine === false)
    ) {
      return;
    }

    flushInProgressRef.current.add(flushKey);
    try {
      const entries = await loadChatOutbox(senderId);
      if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
      const ownerEntries = entries.filter((entry) =>
        ownerFenceRef.current.matchesEntry(ownerToken, entry),
      );
      hasRoomOutboxRef.current = ownerEntries.some((entry) => entry.roomId === roomId);
      const key = getFetchRoomMessagesQueryKey(roomId);
      const cached = queryClient.getQueryData<Message[]>(key) ?? [];
      const confirmedOperations = new Set(
        cached
          .filter((message) => message.roomSeq > 0 && message.clientMessageId)
          .map((message) => message.clientMessageId!),
      );

      for (const entry of ownerEntries) {
        if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
        if (entry.roomId !== roomId) continue;
        if (confirmedOperations.has(entry.clientMessageId)) {
          try {
            await removeChatOutboxEntry(senderId, entry.clientMessageId);
            if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
          } catch {
            // Retry local cleanup during the next bounded flush.
          }
        }
      }

      // Drain only a small batch at a time so a reconnect cannot unleash a
      // burst of every queued mutation at once.
      const retryable = ownerEntries
        .filter(
          (entry) =>
            entry.roomId === roomId &&
            !confirmedOperations.has(entry.clientMessageId) &&
            canRetryChatOutboxEntry(entry, Date.now()),
        )
        .slice(0, 3);
      for (const entry of retryable) {
        if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
        await deliverEntry(entry, ownerToken);
      }
    } catch {
      // Storage can be temporarily unavailable (notably iOS private mode).
      // Leave the current UI state intact and retry on the next foreground tick.
    } finally {
      flushInProgressRef.current.delete(flushKey);
    }
  }, [deliverEntry, me?.id, queryClient, roomId]);

  useEffect(() => {
    const ownerToken = ownerFenceRef.current.capture();
    if (!ownerToken) return;
    const senderId = ownerToken.ownerId;
    let stopped = false;

    void loadChatOutbox(senderId)
      .then((entries) => {
        if (stopped || !ownerFenceRef.current.isCurrent(ownerToken)) return;
        const pending = entries.filter(
          (entry) =>
            entry.roomId === roomId &&
            ownerFenceRef.current.matchesEntry(ownerToken, entry),
        );
        hasRoomOutboxRef.current = pending.length > 0;
        if (pending.length > 0) {
          const key = getFetchRoomMessagesQueryKey(roomId);
          const hydrated = pending.map(
            (entry): Message => ({
              id: entry.tempId,
              roomId: entry.roomId,
              roomSeq: 0,
              senderId: entry.senderId,
              senderProfile: senderProfile ?? null,
              authorKind: "user",
              type: entry.type,
              content: entry.content,
              replyToMessageId: entry.replyToMessageId,
              clientMessageId: entry.clientMessageId,
              deletedAt: null,
              stickerBadges: [],
              linkPreview: null,
              createdAt: new Date(entry.createdAt).toISOString(),
              readCount: 0,
              sender: (me as any) ?? undefined,
              _deliveryState: entry.deliveryState,
            } as Message),
          );
          queryClient.setQueryData<Message[]>(key, (old = []) =>
            mergeChatMessages(old, hydrated) as Message[],
          );
        }
        if (pending.length > 0) void flushRoomOutbox();
      })
      .catch(() => undefined);

    const timer = setInterval(() => {
      if (hasRoomOutboxRef.current) void flushRoomOutbox();
    }, 5_000);
    noteChatResource("timers", 1);
    const onResume = () => void flushRoomOutbox();
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("online", onResume);
      window.addEventListener("pageshow", onResume);
      document.addEventListener("visibilitychange", onResume);
      noteChatResource("listeners", 3);
    }
    return () => {
      stopped = true;
      clearInterval(timer);
      noteChatResource("timers", -1);
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.removeEventListener("online", onResume);
        window.removeEventListener("pageshow", onResume);
        document.removeEventListener("visibilitychange", onResume);
        noteChatResource("listeners", -3);
      }
      for (const controller of inFlightRef.current.values()) controller.abort();
      inFlightRef.current.clear();
      uploadControllerRef.current?.abort();
      uploadControllerRef.current = null;
      terminalCallbacksRef.current.clear();
    };
  }, [flushRoomOutbox, me?.id, queryClient, roomId, senderProfile?.id]);

  const sendOptimisticMessage = React.useCallback(
    async ({
      content,
      type,
      errorMessage,
      onError,
    }: {
      content: string;
      type: SendableMessageType;
      errorMessage: string;
      onError?: () => void;
    }): Promise<boolean> => {
      const ownerToken = ownerFenceRef.current.capture();
      if (!ownerToken) return false;
      forceStickToBottom();
      const activeReply = replyTo;
      const key = getFetchRoomMessagesQueryKey(roomId);
      const clientMessageId = newClientMessageId();
      const tempId = `temp-${clientMessageId}`;
      const createdAt = Date.now();
      const entry: ChatOutboxEntry = {
        clientMessageId,
        tempId,
        roomId,
        senderId: ownerToken.ownerId,
        senderProfileId: ownerToken.profileId,
        content,
        type,
        replyToMessageId: activeReply?.id ?? null,
        createdAt,
        attempts: 0,
        nextAttemptAt: createdAt,
        deliveryState: "pending",
        retryable: true,
      };
      if (!entry.senderId) return false;
      const optimistic: Message = {
        id: tempId,
        roomId,
        roomSeq: 0,
        senderId: ownerToken.ownerId,
        senderProfile: senderProfile ?? null,
        authorKind: "user",
        type,
        content,
        replyToMessageId: activeReply?.id ?? null,
        clientMessageId,
        replyTo: activeReply ? replyPreviewFromMessage(activeReply) : null,
        deletedAt: null,
        stickerBadges: [],
        linkPreview: null,
        createdAt: new Date(createdAt).toISOString(),
        readCount: 0,
        sender: (me as any) ?? null,
        _deliveryState: "pending",
      } as Message;

      try {
        // Persist before network I/O. If the app is killed or the response is
        // lost after the server commits, the exact same operation ID is retried.
        await upsertChatOutboxEntry(entry.senderId, entry);
        if (!ownerFenceRef.current.matchesEntry(ownerToken, entry)) return false;
        hasRoomOutboxRef.current = true;
        queryClient.setQueryData<Message[]>(key, (old = []) =>
          mergeChatMessages(old, [optimistic]) as Message[],
        );
        if (onError) terminalCallbacksRef.current.set(clientMessageId, onError);
        clearReply();
        void deliverEntry(entry, ownerToken);
        return true;
      } catch (error) {
        if (!ownerFenceRef.current.matchesEntry(ownerToken, entry)) return false;
        onError?.();
        if (error instanceof ChatOutboxCapacityError) {
          crossAlert(
            "전송 대기 한도",
            "전송을 기다리는 메시지가 많습니다. 연결이 복구된 뒤 다시 시도해주세요.",
          );
        } else {
          crossAlert("오류", errorMessage);
        }
        return false;
      }
    },
    [clearReply, deliverEntry, forceStickToBottom, me, queryClient, replyTo, roomId, senderProfile],
  );

  // Returns false so the composer can restore its input after a failed send.
  const sendText = React.useCallback(
    async (content: string): Promise<boolean> => {
      const trimmed = content.trim();
      if (!trimmed) return false;
      if (isDungeon) beginDungeonThinking();
      return sendOptimisticMessage({
        content: trimmed,
        type: "text",
        errorMessage: "메시지를 보내지 못했습니다. 다시 시도해주세요.",
        onError: clearDungeonThinking,
      });
    },
    [beginDungeonThinking, clearDungeonThinking, isDungeon, sendOptimisticMessage],
  );

  const handleSendSticker = React.useCallback(
    async (code: string) => {
      await sendOptimisticMessage({
        content: code,
        type: "sticker",
        errorMessage: "스티커를 보내지 못했습니다. 다시 시도해주세요.",
      });
    },
    [sendOptimisticMessage],
  );

  const sendImageObjectPath = React.useCallback(
    (objectPath: string) =>
      sendOptimisticMessage({
        content: objectPath,
        type: "image",
        errorMessage: "사진을 보내지 못했습니다. 다시 시도해주세요.",
      }),
    [sendOptimisticMessage],
  );

  const sendUploadedFile = React.useCallback(
    (picked: UploadedFile) =>
      sendOptimisticMessage({
        content: encodeFileContent({
          path: picked.objectPath,
          name: picked.name,
          size: picked.size,
          mime: picked.mimeType,
        }),
        type: "file",
        errorMessage: "파일을 보내지 못했습니다. 다시 시도해주세요.",
      }),
    [sendOptimisticMessage],
  );

  const uploadAndSendImageBlob = React.useCallback(
    async (blob: Blob, name = `image-${Date.now()}.jpg`) => {
      const ownerToken = ownerFenceRef.current.capture();
      if (!ownerToken) return;
      if (uploadTask) {
        crossAlert("업로드 중", "현재 업로드가 끝난 뒤 다시 시도해주세요.");
        return;
      }
      const controller = new AbortController();
      uploadControllerRef.current = controller;
      setUploadTask({ kind: "image", progress: null, controller });
      try {
        const objectPath = await uploadBlob(blob, name, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
            setUploadTask((current) =>
              current?.controller === controller ? { ...current, progress } : current,
            );
          },
        });
        if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
        await sendImageObjectPath(objectPath);
      } catch (error) {
        if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
        if (error instanceof UploadCancelledError) return;
        if (error instanceof ImageTooLargeError) {
          crossAlert("사진 크기 초과", "사진 크기는 10MB를 초과할 수 없습니다.");
        } else {
          crossAlert("오류", "사진을 보내지 못했습니다. 다시 시도해주세요.");
        }
      } finally {
        if (uploadControllerRef.current === controller) {
          uploadControllerRef.current = null;
        }
        setUploadTask((current) => (current?.controller === controller ? null : current));
      }
    },
    [sendImageObjectPath, uploadTask],
  );

  const uploadAndSendFileBlob = React.useCallback(
    async (file: File) => {
      const ownerToken = ownerFenceRef.current.capture();
      if (!ownerToken) return;
      if (uploadTask) {
        crossAlert("업로드 중", "현재 업로드가 끝난 뒤 다시 시도해주세요.");
        return;
      }
      const controller = new AbortController();
      uploadControllerRef.current = controller;
      setUploadTask({ kind: "file", progress: null, controller });
      try {
        const picked = await uploadFileBlob(
          file,
          uploadFileName(file, "file"),
          file.type || "application/octet-stream",
          {
            signal: controller.signal,
            onProgress: (progress) => {
              if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
              setUploadTask((current) =>
                current?.controller === controller ? { ...current, progress } : current,
              );
            },
          },
        );
        if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
        await sendUploadedFile(picked);
      } catch (error) {
        if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
        if (error instanceof UploadCancelledError) return;
        if (error instanceof FileTooLargeError) {
          crossAlert("파일 크기 초과", "파일 크기는 25MB를 초과할 수 없습니다.");
        } else {
          crossAlert("오류", "파일을 보내지 못했습니다. 다시 시도해주세요.");
        }
      } finally {
        if (uploadControllerRef.current === controller) {
          uploadControllerRef.current = null;
        }
        setUploadTask((current) => (current?.controller === controller ? null : current));
      }
    },
    [sendUploadedFile, uploadTask],
  );

  const handleWebUploadFiles = React.useCallback(
    async (files: File[]) => {
      const ownerToken = ownerFenceRef.current.capture();
      if (!ownerToken) return;
      if (!files.length) return;
      if (uploadTask) {
        crossAlert("업로드 중", "현재 업로드가 끝난 뒤 다시 시도해주세요.");
        return;
      }
      for (const file of files) {
        if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
        if (isImageTransferFile(file)) {
          await uploadAndSendImageBlob(file, uploadFileName(file, "image"));
        } else {
          await uploadAndSendFileBlob(file);
        }
      }
    },
    [uploadAndSendFileBlob, uploadAndSendImageBlob, uploadTask],
  );

  const handlePickImage = React.useCallback(async () => {
    const ownerToken = ownerFenceRef.current.capture();
    if (!ownerToken) return;
    if (uploadTask) return;
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setUploadTask({ kind: "image", progress: null, controller });
    try {
      const picked = await pickAndUploadImages({
        signal: controller.signal,
        onProgress: (progress) => {
          if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
          setUploadTask((current) =>
            current?.controller === controller ? { ...current, progress } : current,
          );
        },
      });
      if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
      if (!picked?.length) return;
      for (const image of picked) {
        if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
        await sendImageObjectPath(image.objectPath);
      }
    } catch (error) {
      if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
      if (error instanceof UploadCancelledError) return;
      if (error instanceof PermissionDeniedError) {
        crossAlert("권한 필요", "사진을 보내려면 사진 접근 권한을 허용해주세요.");
      } else if (error instanceof ImageTooLargeError) {
        crossAlert("사진 크기 초과", "사진 크기는 10MB를 초과할 수 없습니다.");
      } else {
        crossAlert("오류", "사진을 보내지 못했습니다. 다시 시도해주세요.");
      }
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null;
      }
      setUploadTask((current) => (current?.controller === controller ? null : current));
    }
  }, [sendImageObjectPath, uploadTask]);

  const handlePickFile = React.useCallback(async () => {
    const ownerToken = ownerFenceRef.current.capture();
    if (!ownerToken) return;
    if (uploadTask) return;
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setUploadTask({ kind: "file", progress: null, controller });
    try {
      const picked = await pickAndUploadFile({
        signal: controller.signal,
        onProgress: (progress) => {
          if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
          setUploadTask((current) =>
            current?.controller === controller ? { ...current, progress } : current,
          );
        },
      });
      if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
      if (!picked) return;
      await sendUploadedFile(picked);
    } catch (error) {
      if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
      if (error instanceof UploadCancelledError) return;
      if (error instanceof FileTooLargeError) {
        crossAlert("파일 크기 초과", "파일 크기는 25MB를 초과할 수 없습니다.");
      } else {
        crossAlert("오류", "파일을 보내지 못했습니다. 다시 시도해주세요.");
      }
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null;
      }
      setUploadTask((current) => (current?.controller === controller ? null : current));
    }
  }, [sendUploadedFile, uploadTask]);

  const retryMessage = React.useCallback(
    async (clientMessageId: string) => {
      const ownerToken = ownerFenceRef.current.capture();
      if (!ownerToken) return;
      const senderId = ownerToken.ownerId;
      const entries = await loadChatOutbox(senderId);
      if (!ownerFenceRef.current.isCurrent(ownerToken)) return;
      const existing = entries.find(
        (entry) =>
          entry.roomId === roomId &&
          entry.clientMessageId === clientMessageId &&
          ownerFenceRef.current.matchesEntry(ownerToken, entry),
      );
      if (!existing) {
        // A catch-up may already have acknowledged and removed this operation.
        void queryClient.invalidateQueries({
          queryKey: getFetchRoomMessagesQueryKey(roomId),
        });
        return;
      }
      const retryable: ChatOutboxEntry = {
        ...existing,
        attempts: 0,
        nextAttemptAt: Date.now(),
        deliveryState: "pending",
        retryable: true,
      };
      await upsertChatOutboxEntry(senderId, retryable);
      if (!ownerFenceRef.current.matchesEntry(ownerToken, retryable)) return;
      updateOptimisticDeliveryState(retryable);
      await deliverEntry(retryable, ownerToken);
    },
    [deliverEntry, me?.id, queryClient, roomId, updateOptimisticDeliveryState],
  );

  const handleCancelUpload = React.useCallback(() => {
    uploadControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || isDungeon || typeof document === "undefined") return;

    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file);
      if (!files.length) return;
      event.preventDefault();
      void handleWebUploadFiles(files);
    };
    const handleDragEnter = (event: DragEvent) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsWebDraggingUpload(true);
    };
    const handleDragOver = (event: DragEvent) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setIsWebDraggingUpload(true);
    };
    const handleDragLeave = (event: DragEvent) => {
      if (!dragEventHasFiles(event)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsWebDraggingUpload(false);
    };
    const handleDrop = (event: DragEvent) => {
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsWebDraggingUpload(false);
      void handleWebUploadFiles(Array.from(event.dataTransfer?.files ?? []));
    };

    document.addEventListener("paste", handlePaste);
    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);
    return () => {
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("drop", handleDrop);
    };
  }, [handleWebUploadFiles, isDungeon]);

  return {
    // Sending is durable once the outbox write completes, so the composer does
    // not block subsequent messages while a cellular acknowledgement is slow.
    isSending: false,
    uploadTask,
    isWebDraggingUpload,
    sendText,
    handleSendSticker,
    handlePickImage,
    handlePickFile,
    handleCancelUpload,
    retryMessage,
  };
}
