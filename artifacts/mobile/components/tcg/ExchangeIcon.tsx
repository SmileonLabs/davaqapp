import React from "react";
import type { SvgProps } from "react-native-svg";
import colors from "@/constants/colors";
import Settings from "@/assets/icons/exchange/settings.svg";
import Home from "@/assets/icons/exchange/home.svg";
import Maximize from "@/assets/icons/exchange/maximize.svg";
import Heart from "@/assets/icons/exchange/heart.svg";
import HeartFilled from "@/assets/icons/exchange/heart-filled.svg";
import MessageCircle from "@/assets/icons/exchange/message-circle.svg";
import Share from "@/assets/icons/exchange/share.svg";
import MoreHorizontal from "@/assets/icons/exchange/more-horizontal.svg";
import Close from "@/assets/icons/exchange/x.svg";
import Plus from "@/assets/icons/exchange/plus.svg";
import Search from "@/assets/icons/exchange/search.svg";
import Map from "@/assets/icons/exchange/map.svg";
import Refresh from "@/assets/icons/exchange/refresh-cw.svg";
import ChevronLeft from "@/assets/icons/exchange/chevron-left.svg";
import ChevronRight from "@/assets/icons/exchange/chevron-right.svg";
import Photo from "@/assets/icons/exchange/image.svg";
import Layers from "@/assets/icons/exchange/layers.svg";
import CheckCircle from "@/assets/icons/exchange/check-circle.svg";
import Circle from "@/assets/icons/exchange/circle.svg";
import ArrowUpRight from "@/assets/icons/exchange/arrow-up-right.svg";
import Repeat from "@/assets/icons/exchange/repeat.svg";

const icons = {
  settings: Settings,
  home: Home,
  maximize: Maximize,
  heart: Heart,
  "heart-filled": HeartFilled,
  "message-circle": MessageCircle,
  share: Share,
  "more-horizontal": MoreHorizontal,
  x: Close,
  plus: Plus,
  search: Search,
  map: Map,
  "refresh-cw": Refresh,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  image: Photo,
  layers: Layers,
  "check-circle": CheckCircle,
  circle: Circle,
  "arrow-up-right": ArrowUpRight,
  repeat: Repeat,
} as const;

export type ExchangeIconName = keyof typeof icons;
export type ExchangeIconProps = {
  name: ExchangeIconName;
  size?: number;
  color?: string;
  /** Selected heart state; other symbols keep their outline shape. */
  filled?: boolean;
  style?: SvgProps["style"];
  testID?: string;
};

/** Vector-only exchange controls shared by iOS, Android, and web. */
export function ExchangeIcon({
  name,
  size = 24,
  color = colors.light.foreground,
  filled = false,
  style,
  testID,
}: ExchangeIconProps) {
  const Graphic = name === "heart" && filled ? HeartFilled : icons[name];
  return (
    <Graphic
      width={size}
      height={size}
      color={color}
      style={style}
      testID={testID}
      accessible={false}
      focusable={false}
    />
  );
}
