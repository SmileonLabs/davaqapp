import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { stickerPage, STICKER_PAGE_SIZE } from "./stickerPickerPolicy.ts";
import { isValidStickerCode } from "../../api-server/src/lib/chatMessagePolicy.ts";
const metadata = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../constants/animatedStickers.ts", import.meta.url),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  {
    exports: metadata,
    require: (path) => path,
  },
);
const catalog = metadata.ANIMATED_STICKERS;
test("expanded pack contains over 200 real animations and keeps legacy message codes", () => {
  assert.ok(catalog.length >= 200);
  assert.equal(new Set(catalog.map((item) => item.code)).size, catalog.length);
  const legacy =
    "1f600 1f602 1f603 1f604 1f60a 1f60d 1f618 1f970 1f60e 1f923 1f642 1f643 1f609 1f44d 1f44e 1f44f 1f64f 1f525 2764_fe0f 1f495 1f389 1f622 1f62d 1f621 1f914 1f973 1f44b 1f4af 2728 1f634 1f628 1f631 1f97a 1f60b 1f92a 1f60f 1f612 1f644 1f44c 1f64c".split(
      " ",
    );
  for (const code of legacy)
    assert.ok(
      catalog.some((item) => item.code === code),
      code,
    );
  for (const item of catalog) {
    assert.ok(isValidStickerCode(item.code), item.code);
    const data = readFileSync(
      new URL(`../assets/animated-stickers/${item.code}.webp`, import.meta.url),
    );
    assert.equal(data.toString("ascii", 0, 4), "RIFF");
    assert.equal(data.toString("ascii", 8, 12), "WEBP");
    let frames = 0,
      hasAnimation = false;
    for (let cursor = 12; cursor + 8 <= data.length; ) {
      const tag = data.toString("ascii", cursor, cursor + 4),
        size = data.readUInt32LE(cursor + 4);
      if (tag === "ANIM") hasAnimation = true;
      if (tag === "ANMF") frames++;
      if (tag === "VP8X") {
        assert.equal(data.readUIntLE(cursor + 12, 3) + 1, 128);
        assert.equal(data.readUIntLE(cursor + 15, 3) + 1, 128);
      }
      cursor += 8 + size + (size % 2);
    }
    assert.ok(hasAnimation && frames > 1, `${item.code} must still animate`);
    assert.equal(
      metadata.ANIMATED_STICKER_SOURCES[item.code],
      `../assets/animated-stickers/${item.code}.webp`,
    );
  }
});
test("paging caps mounted animations and reaches every sticker without duplicates", () => {
  const seen = [];
  const first = stickerPage(catalog, "전체", "", 0);
  assert.equal(first.items.length, STICKER_PAGE_SIZE);
  assert.equal(STICKER_PAGE_SIZE, 12);
  for (let page = 0; page < first.pages; page++)
    seen.push(
      ...stickerPage(catalog, "전체", "", page).items.map((item) => item.code),
    );
  assert.deepEqual(
    seen,
    Array.from(catalog, (item) => item.code),
  );
  assert.equal(stickerPage(catalog, "전체", "", 999).page, first.pages - 1);
});
test("category and case-insensitive search do not leak other categories; empty results are safe", () => {
  assert.ok(
    stickerPage(catalog, "음식", "", 0).items.every(
      (item) => item.category === "음식",
    ),
  );
  assert.ok(stickerPage(catalog, "전체", " SMILE ", 0).total > 0);
  assert.ok(stickerPage(catalog, "전체", "축하", 0).total > 0);
  const empty = stickerPage(catalog, "전체", "this-does-not-exist", 50);
  assert.equal(empty.total, 0);
  assert.equal(empty.page, 0);
  assert.equal(empty.pages, 1);
});
