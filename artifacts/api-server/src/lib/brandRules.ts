import { z } from "zod/v4";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  createHash,
} from "node:crypto";
export const brandCategories = ["food", "culture", "learning", "life"] as const;
export const brandConfig = z.object({
  title: z.string().trim().min(3).max(80),
  brand: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(2000),
  category: z.enum(brandCategories),
  rewardType: z.enum(["coupon", "product", "experience"]),
  rewardTitle: z.string().trim().min(2).max(120),
  terms: z.string().trim().min(10).max(3000),
  extraCost: z.string().trim().min(1).max(500),
  support: z.string().trim().min(3).max(300),
  region: z.string().trim().max(80),
  online: z.boolean(),
  endsAt: z.iso.datetime(),
  duration: z.literal(30),
  cost: z.number().int().min(0).max(1000000),
  videoA: z
    .string()
    .regex(/^\/objects\/(?:[a-zA-Z0-9_-]+\/)*uploads\/[a-zA-Z0-9-]+$/),
  videoB: z
    .string()
    .regex(/^\/objects\/(?:[a-zA-Z0-9_-]+\/)*uploads\/[a-zA-Z0-9-]+$/),
  rightsConfirmed: z.literal(true),
  fundingConfirmed: z.literal(true),
});
export const answerMap = z
  .array(
    z
      .object({
        start: z.number().min(0).max(29),
        end: z.number().min(1).max(30),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        w: z.number().min(0.04).max(0.7),
        h: z.number().min(0.04).max(0.7),
      })
      .refine(
        (a) => a.end > a.start && a.x + a.w <= 1 && a.y + a.h <= 1,
        "영역과 시간 범위를 확인해 주세요.",
      ),
  )
  .min(2)
  .max(3);
export const preferenceInput = z.object({
  categories: z.array(z.enum(brandCategories)).max(4),
  region: z.string().trim().max(80),
  personalized: z.boolean(),
  version: z.number().int().positive(),
});
export const eventInput = z.object({
  requestKey: z.uuid(),
  lease: z.string().min(32).max(128),
  sequence: z.number().int().positive(),
  action: z.enum([
    "play",
    "tick",
    "pause",
    "answer",
    "finish",
    "retry",
    "abandon",
    "keepalive",
  ]),
  position: z.number().min(0).max(30),
  positionB: z.number().min(0).max(30),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
});
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
function key() {
  const raw = process.env.BRAND_REWARD_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(raw))
    throw new Error("Brand reward encryption is not configured");
  return Buffer.from(raw, "hex");
}
export function encryptCode(code: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(".");
}
export function decryptCode(code: string) {
  const [iv, tag, data] = code.split(".");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    cipher.update(Buffer.from(data, "base64")),
    cipher.final(),
  ]).toString("utf8");
}
export const fingerprint = (brand: string, code: string) =>
  createHmac("sha256", key())
    .update(brand.trim().toLowerCase() + "\0" + code.trim())
    .digest("hex");
export function inside(
  a: z.infer<typeof answerMap>[number],
  t: number,
  x: number,
  y: number,
) {
  return (
    t >= a.start &&
    t <= a.end &&
    x >= a.x &&
    x <= a.x + a.w &&
    y >= a.y &&
    y <= a.y + a.h
  );
}
export const brandEnabled = () => process.env.BRAND_EXCHANGE_ENABLED === "true";
export const brandStartsEnabled = () =>
  brandEnabled() && process.env.BRAND_EXCHANGE_STARTS_ENABLED === "true";
