import { z } from "zod/v4";
import { categories } from "./exchangeRules";
export const wishFields = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).default(""),
  keywords: z
    .array(z.string().trim().min(2).max(40))
    .min(1)
    .max(6)
    .transform((v) => [...new Set(v)]),
  kind: z.enum(["goods", "service", "experience"]),
  category: z.enum(categories),
  imageKey: z
    .string()
    .regex(/^\/objects\/[a-zA-Z0-9/_-]+$/)
    .nullable()
    .default(null),
});
export const createWishInput = wishFields
  .extend({ requestKey: z.string().min(8).max(100) })
  .strict();
export const updateWishInput = wishFields
  .partial()
  .extend({
    description: z.string().trim().max(1000).optional(),
    imageKey: z
      .string()
      .regex(/^\/objects\/[a-zA-Z0-9/_-]+$/)
      .nullable()
      .optional(),
    version: z.number().int().positive(),
    status: z.enum(["active", "paused", "fulfilled", "deleted"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, "변경할 내용을 선택해 주세요.");
export const wishDraftInput = z
  .object({
    text: z.string().trim().max(2000).default(""),
    imageKey: z
      .string()
      .regex(/^\/objects\/[a-zA-Z0-9/_-]+$/)
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (v) => v.text.length >= 2 || !!v.imageKey,
    "원하는 것을 적거나 사진을 첨부해 주세요.",
  );
export const wishDraftOutput = z
  .object({
    title: z.string().trim().max(80),
    description: z.string().trim().max(1000),
    keywords: z.array(z.string().trim().min(2).max(40)).max(6),
    kind: z.enum(["goods", "service", "experience"]),
    category: z.enum(categories),
    questions: z.array(z.string().max(200)).max(3),
  })
  .strict();
