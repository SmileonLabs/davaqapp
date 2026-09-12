type Box = { type: string; start: number; end: number };
function boxes(b: Buffer, start = 0, end = b.length): Box[] {
  const list: Box[] = [];
  for (let p = start; p + 8 <= end; ) {
    let size = b.readUInt32BE(p),
      head = 8;
    const type = b.toString("ascii", p + 4, p + 8);
    if (size === 1) {
      if (p + 16 > end) throw Error("MP4 box");
      size = Number(b.readBigUInt64BE(p + 8));
      head = 16;
    }
    if (size === 0) size = end - p;
    if (!Number.isSafeInteger(size) || size < head || p + size > end)
      throw Error("MP4 box bounds");
    list.push({ type, start: p + head, end: p + size });
    p += size;
  }
  return list;
}
export function brandMp4Info(b: Buffer) {
  const top = boxes(b);
  if (
    !top.some((x) => x.type === "ftyp") ||
    !top.some((x) => x.type === "mdat")
  )
    throw Error("MP4 media required");
  const moov = top.find((x) => x.type === "moov");
  if (!moov) throw Error("MP4 metadata required");
  const tracks = boxes(b, moov.start, moov.end).filter(
    (x) => x.type === "trak",
  );
  for (const track of tracks) {
    const children = boxes(b, track.start, track.end),
      mdia = children.find((x) => x.type === "mdia"),
      tkhd = children.find((x) => x.type === "tkhd");
    if (!mdia || !tkhd) continue;
    const media = boxes(b, mdia.start, mdia.end),
      hdlr = media.find((x) => x.type === "hdlr"),
      mdhd = media.find((x) => x.type === "mdhd"),
      minf = media.find((x) => x.type === "minf");
    if (
      !hdlr ||
      hdlr.start + 12 > hdlr.end ||
      b.toString("ascii", hdlr.start + 8, hdlr.start + 12) !== "vide" ||
      !mdhd ||
      !minf
    )
      continue;
    const v = b[mdhd.start],
      offset = mdhd.start + (v === 1 ? 20 : 12);
    if (offset + (v === 1 ? 12 : 8) > mdhd.end) throw Error("MP4 duration");
    const scale = b.readUInt32BE(offset),
      duration =
        v === 1
          ? Number(b.readBigUInt64BE(offset + 4))
          : b.readUInt32BE(offset + 4);
    const seconds = duration / scale,
      width = b.readUInt32BE(tkhd.end - 8) / 65536,
      height = b.readUInt32BE(tkhd.end - 4) / 65536;
    const stbl = boxes(b, minf.start, minf.end).find((x) => x.type === "stbl");
    const stsd =
      stbl && boxes(b, stbl.start, stbl.end).find((x) => x.type === "stsd");
    if (
      !stsd ||
      stsd.start + 8 > stsd.end ||
      !boxes(b, stsd.start + 8, stsd.end).some((x) => x.type === "avc1")
    )
      throw Error("H.264 MP4 required");
    if (
      !Number.isFinite(seconds) ||
      Math.abs(seconds - 30) > 0.2 ||
      width < 160 ||
      height < 90 ||
      width > 1920 ||
      height > 1920
    )
      throw Error("30-second video required");
    return { seconds, width, height };
  }
  throw Error("Video track required");
}
