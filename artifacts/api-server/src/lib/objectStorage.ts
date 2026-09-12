import { randomUUID } from "crypto";
import { Readable } from "stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Storage, File } from "@google-cloud/storage";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

type StoredObject =
  | { backend: "replit"; file: File }
  | { backend: "s3"; key: string };

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  private useS3(): boolean {
    return Boolean(process.env.S3_BUCKET);
  }

  private getS3Bucket(): string {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      throw new Error(
        "S3_BUCKET must be set when using S3-compatible object storage",
      );
    }
    return bucket;
  }

  private getS3Prefix(): string {
    return (process.env.S3_PRIVATE_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
  }

  private getS3PublicPrefixes(): string[] {
    const raw =
      process.env.S3_PUBLIC_PREFIXES ??
      process.env.PUBLIC_OBJECT_SEARCH_PATHS ??
      "";
    return raw
      .split(",")
      .map((x) => x.trim().replace(/^\/+|\/+$/g, ""))
      .filter(Boolean);
  }

  private createS3Client(endpointOverride?: string): S3Client {
    const endpoint = endpointOverride ?? process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE
      ? process.env.S3_FORCE_PATH_STYLE === "true"
      : Boolean(endpoint);

    return new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint,
      forcePathStyle,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).",
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var.",
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<StoredObject | null> {
    if (this.useS3()) {
      const keyCandidates = this.getS3PublicPrefixes().map(
        (prefix) => `${prefix}/${filePath}`,
      );
      for (const key of keyCandidates) {
        try {
          await this.createS3Client().send(
            new HeadObjectCommand({ Bucket: this.getS3Bucket(), Key: key }),
          );
          return { backend: "s3", key };
        } catch {
          // Try the next configured public prefix.
        }
      }
      return null;
    }

    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return { backend: "replit", file };
      }
    }

    return null;
  }

  async downloadObject(
    object: StoredObject,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    if (object.backend === "s3") {
      const result = await this.createS3Client().send(
        new GetObjectCommand({ Bucket: this.getS3Bucket(), Key: object.key }),
      );
      if (!result.Body) throw new ObjectNotFoundError();

      const headers: Record<string, string> = {
        "Content-Type": result.ContentType || "application/octet-stream",
        "Cache-Control": `private, max-age=${cacheTtlSec}`,
      };
      if (result.ContentLength !== undefined) {
        headers["Content-Length"] = String(result.ContentLength);
      }
      return new Response(toWebStream(result.Body), { headers });
    }

    const [metadata] = await object.file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(object.file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = object.file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type":
        (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async brandVideoReadUrl(objectPath: string): Promise<string | null> {
    if (!this.useS3()) return null;
    const object = await this.getObjectEntityFile(objectPath);
    if (object.backend !== "s3") return null;
    return getSignedUrl(
      this.createS3Client(),
      new GetObjectCommand({
        Bucket: this.getS3Bucket(),
        Key: object.key,
        ResponseContentType: "video/mp4",
        ResponseContentDisposition: "inline",
        ResponseCacheControl: "private, max-age=300",
      }),
      { expiresIn: 900 },
    );
  }

  async getObjectEntityUploadURL(): Promise<string> {
    if (this.useS3()) {
      const prefix = this.getS3Prefix();
      const objectKey = [prefix, "uploads", randomUUID()]
        .filter(Boolean)
        .join("/");
      const publicEndpoint =
        process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT;
      const signed = await getSignedUrl(
        this.createS3Client(publicEndpoint),
        new PutObjectCommand({ Bucket: this.getS3Bucket(), Key: objectKey }),
        { expiresIn: 900 },
      );
      return signed;
    }

    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var.",
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async uploadObjectEntity(data: Buffer, contentType: string): Promise<string> {
    if (this.useS3()) {
      const prefix = this.getS3Prefix();
      const objectKey = [prefix, "uploads", randomUUID()]
        .filter(Boolean)
        .join("/");
      await this.createS3Client().send(
        new PutObjectCommand({
          Bucket: this.getS3Bucket(),
          Key: objectKey,
          Body: data,
          ContentType: contentType,
          ContentLength: data.length,
        }),
      );
      return `/objects/${objectKey}`;
    }

    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(data, { metadata: { contentType } });
    return this.normalizeObjectEntityPath(
      `https://storage.googleapis.com/${bucketName}/${objectName}`,
    );
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObject> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");

    if (this.useS3()) {
      try {
        await this.createS3Client().send(
          new HeadObjectCommand({ Bucket: this.getS3Bucket(), Key: entityId }),
        );
      } catch {
        throw new ObjectNotFoundError();
      }
      return { backend: "s3", key: entityId };
    }

    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return { backend: "replit", file: objectFile };
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (this.useS3()) {
      try {
        const url = new URL(rawPath);
        const bucket = this.getS3Bucket();
        const pathParts = url.pathname.split("/").filter(Boolean);
        const objectKey =
          pathParts[0] === bucket
            ? pathParts.slice(1).join("/")
            : pathParts.join("/");
        return objectKey ? `/objects/${objectKey}` : rawPath;
      } catch {
        return rawPath;
      }
    }

    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    if (objectFile.backend === "s3") return normalizedPath;
    await setObjectAclPolicy(objectFile.file, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StoredObject;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    if (objectFile.backend === "s3") return true;
    return canAccessObject({
      userId,
      objectFile: objectFile.file,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function toWebStream(body: unknown): ReadableStream<Uint8Array> {
  const maybeTransform = body as {
    transformToWebStream?: () => ReadableStream<Uint8Array>;
  };
  if (typeof maybeTransform?.transformToWebStream === "function") {
    return maybeTransform.transformToWebStream();
  }
  if (body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream<Uint8Array>;
  }
  return Readable.toWeb(
    Readable.from(body ? [body] : []),
  ) as ReadableStream<Uint8Array>;
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }

  const { signed_url: signedURL } = (await response.json()) as {
    signed_url: string;
  };
  return signedURL;
}
