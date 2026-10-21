import { expect, it } from "vitest";
import { publicDavaqAvatar } from "./davaqAvatarPolicy";
it("does not expose legacy recipes, external account images or unselected old uploads", () => {
  expect(
    publicDavaqAvatar("anotherme-avatar:v1:{}", { avatarSource: "davaq" }),
  ).toBeNull();
  expect(
    publicDavaqAvatar("https://anotherme.example/avatar.png", {
      avatarSource: "davaq",
    }),
  ).toBeNull();
  expect(publicDavaqAvatar("/objects/old-photo", {})).toBeNull();
  expect(
    publicDavaqAvatar("/objects/davaq/photo", { avatarSource: "davaq" }),
  ).toBe("/objects/davaq/photo");
});

it("assigns an immutable card by profile identity, without overwriting selected uploads", () => {
  const identity = "profile-123";
  const first = publicDavaqAvatar(null, {}, identity);
  expect(first).toMatch(/^https:\/\/assets.tcgdex.net\/en\/base\/base1\/\d+\/high.webp$/);
  expect(publicDavaqAvatar(null, {}, identity)).toBe(first);
  expect(publicDavaqAvatar("/objects/own", { avatarSource: "davaq" }, identity)).toBe("/objects/own");
  expect(publicDavaqAvatar("https://external.example/private.jpg", {}, identity)).toBe(first);
  const values = new Set(Array.from({ length: 100 }, (_, i) => publicDavaqAvatar(null, {}, "profile-" + i)));
  expect(values.size).toBeGreaterThan(8);
});
