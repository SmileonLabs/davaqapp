DavaQ exchange SVG icons

Each symbol is an editable SVG source with a 24 x 24 viewBox, a 1.9 px
rounded stroke, and currentColor. No font, Unicode symbol, emoji, or bitmap
is required. The same paths render in iOS, Android, and web through the
project's existing react-native-svg-transformer Metro configuration.

Usage:
  import { ExchangeIcon } from "@/components/tcg/ExchangeIcon";
  <ExchangeIcon name="heart" size={28} color="#FFFFFF" />
  <ExchangeIcon name="heart" size={28} color="#ED5B7B" filled={liked} />
  <ExchangeIcon name="message-circle" size={24} color="#FFFFFF" />
  <ExchangeIcon name="repeat" size={32} color="#6D4AFF" />

Use size 24 for compact header controls, 28 for feed side actions, and 32
for prominent controls. Keep the surrounding press target at least 44 x 44
points. Put the accessible label and selected state on the surrounding
Pressable; the graphic is decorative. The filled option selects the filled
heart asset, and heart-filled is also available as an explicit name.

Available names:
  home, maximize, heart, heart-filled, message-circle, share, more-horizontal, x, plus,
  search, map, refresh-cw, chevron-left, chevron-right, image, layers,
  check-circle, circle, arrow-up-right, repeat

Add a symbol by creating a matching SVG asset and a static import/registry
entry in ExchangeIcon.tsx. Preserve viewBox, stroke width, rounded ends,
and currentColor. The existing shared Feather/C.Icon implementation is
not modified by this icon set.

Validation from the repository root:
  node --test artifacts/mobile/components/tcg/ExchangeIcon.test.mjs
