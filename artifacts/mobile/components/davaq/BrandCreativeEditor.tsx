import React from "react";
import { Notice } from "./UI";
export type Difference = {
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
};
export default function BrandCreativeEditor(_: {
  onChange: (a: string, b: string, answers: Difference[]) => void;
}) {
  return <Notice>브랜드 영상 등록은 DavaQ 웹에서 이용해 주세요.</Notice>;
}
