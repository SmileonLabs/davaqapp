import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Orval emits response schemas in both generated/api.ts and generated/types/index.ts.
// Keep the runtime Zod schema as the public export when a response name collides.
const barrel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/api-zod/src/generated/types/index.ts");
if (fs.existsSync(barrel)) {
  const source = fs.readFileSync(barrel, "utf8");
  const markers = new Map([
    ["export * from './davaqEnqueueConversationMessageBody';", "// DavaqEnqueueConversationMessageBody uses the canonical generated Zod export."],
    ["export * from './davaqCreateMemoryBody';", "// DavaqCreateMemoryBody uses the canonical generated Zod export."],
    ["export * from './davaqMatchFeedbackBody';", "// DavaqMatchFeedbackBody uses the canonical generated Zod export."],
    ["export * from './davaqRegistrationDraftBody';", "// DavaqRegistrationDraftBody uses the canonical generated Zod export."],
    ["export * from './davaqResolveReviewBody';", "// DavaqResolveReviewBody uses the canonical generated Zod export."],
    ["export * from './davaqReviewProposalBody';", "// DavaqReviewProposalBody uses the canonical generated Zod export."],
    ["export * from './davaqSendAgentMessageBody';", "// DavaqSendAgentMessageBody uses the canonical generated Zod export."],
    ["export * from './davaqSetFavoriteBody';", "// DavaqSetFavoriteBody uses the canonical generated Zod export."],
    ["export * from './davaqUpdateMemoryBody';", "// DavaqUpdateMemoryBody uses the canonical generated Zod export."],
    ["export * from './globalSearchResponse';", "// GlobalSearchResponse is exported from generated/api as the canonical Zod schema."],
    ["export * from './blockSearchTrendingTermBody';", "// BlockSearchTrendingTermBody is exported from generated/api as the canonical Zod schema."],
    ["export * from './updateMyActiveCharacterProfileBody';", "// UpdateMyActiveCharacterProfileBody is exported from generated/api as the canonical Zod schema."],
    ["export * from './updateMyCharacterProfileBody';", "// UpdateMyCharacterProfileBody is exported from generated/api as the canonical Zod schema."],
    ["export * from './createMyFanCharacterProfileBody';", "// CreateMyFanCharacterProfileBody is exported from generated/api as the canonical Zod schema."],
    ["export * from './purchaseMyCharacterAvatarItemBody';", "// PurchaseMyCharacterAvatarItemBody is exported from generated/api as the canonical Zod schema."],
    ["export * from './equipMyCharacterAvatarItemBody';", "// EquipMyCharacterAvatarItemBody is exported from generated/api as the canonical Zod schema."],
    ["export * from './updateAdminCharacterProfileStatusBody';", "// UpdateAdminCharacterProfileStatusBody is exported from generated/api as the canonical Zod schema."],
  ]);
  let next = source;
  for (const [marker, replacement] of markers) next = next.replace(marker, replacement);
  if (next !== source) fs.writeFileSync(barrel, next);
}

// Orval/Prettier can leave an extra blank line at EOF in split outputs. That
// makes `git diff --check` fail even though a second generation is otherwise
// identical. Normalize generated TypeScript files to one final newline.
const generatedRoots = [
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/api-client-react/src/generated"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/api-zod/src/generated"),
];
for (const root of generatedRoots) {
  if (!fs.existsSync(root)) continue;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const source = fs.readFileSync(target, "utf8");
        const normalized = `${source.trimEnd()}\n`;
        if (normalized !== source) fs.writeFileSync(target, normalized);
      }
    }
  }
}
