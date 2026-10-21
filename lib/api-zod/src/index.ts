export * from "./generated/api";
export * from "./generated/types";

// Some endpoint parameter names are emitted by both generators. Prefer the zod
// schema export; a query-only shape remains available as a generated type where
// applicable (for example, `ListClanMemoriesQueryParams`).
export {
  FetchRoomChangesParams,
  FetchRoomMessagesParams,
  ListClanMemoriesParams,
  UnpinRoomMessageParams,
  GetUsersUserIdPostsParams,
  GetUsersUserIdGrowthRecordsParams,
  GetUsersUserIdBattleResultsParams,
  GetPublicCharacterProfileParams,
  PostFanCommunitiesIdBroadcastsBody,
  PostFanCommunitiesIdMissionsBody,
} from "./generated/api";

// `CreateClanWarBody` and `SubmitClanWarArgumentBody` are emitted by BOTH
// generators (a zod body schema in generated/api and a body type in
// generated/types). Prefer the zod schemas; the type shapes remain available via
// `z.infer<typeof ...>`.
export { CreateClanWarBody, SubmitClanWarArgumentBody } from "./generated/api";

// The generated API schema and generated type barrel use the same name for
// this body. Keep the runtime Zod schema as the canonical public export and
// expose the type-only shape under an explicit alias.
export { ResolveStarFeedReportBody } from "./generated/api";
export type { ResolveStarFeedReportBody as ResolveStarFeedReportBodyType } from "./generated/types";

// Keep the runtime validation schema canonical while preserving access to the
// generated request body type without a barrel export collision.
export { UpdateMyActiveCharacterProfileBody } from "./generated/api";
export type { UpdateMyActiveCharacterProfileBody as UpdateMyActiveCharacterProfileBodyType } from "./generated/types/updateMyActiveCharacterProfileBody";
export { UpdateMyCharacterProfileBody } from "./generated/api";
export type { UpdateMyCharacterProfileBody as UpdateMyCharacterProfileBodyType } from "./generated/types/updateMyCharacterProfileBody";
export { CreateMyFanCharacterProfileBody } from "./generated/api";
export type { CreateMyFanCharacterProfileBody as CreateMyFanCharacterProfileBodyType } from "./generated/types/createMyFanCharacterProfileBody";
export { UpdateAdminCharacterProfileStatusBody } from "./generated/api";
export type { UpdateAdminCharacterProfileStatusBody as UpdateAdminCharacterProfileStatusBodyType } from "./generated/types/updateAdminCharacterProfileStatusBody";
