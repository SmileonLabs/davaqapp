export type GifResult = {
  id: string;
  title: string;
  url: string;
  source: string;
  license: string;
  author: string;
  width: number;
  height: number;
};
const plain = (value: string = "") => value.replace(/<[^>]*>/g, "").trim();
export async function searchGifs(
  query: string,
  signal?: AbortSignal,
): Promise<GifResult[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrnamespace: "6",
    gsrlimit: "24",
    gsrsearch: `${query.trim() || "cat"} filemime:image/gif`,
    prop: "imageinfo",
    iiprop: "url|mime|size|extmetadata",
  });
  const response = await fetch(
    `https://commons.wikimedia.org/w/api.php?${params}`,
    { signal },
  );
  if (!response.ok) throw new Error("GIF 검색 연결 실패");
  const data = await response.json();
  return Object.values(data.query?.pages ?? {})
    .flatMap((page: any) => {
      const info = page.imageinfo?.[0],
        meta = info?.extmetadata;
      if (
        info?.mime !== "image/gif" ||
        info.size > 8 * 1024 * 1024 ||
        !info.url?.startsWith("https://upload.wikimedia.org/") ||
        typeof info.descriptionurl !== "string" ||
        !info.descriptionurl.startsWith("https://commons.wikimedia.org/") ||
        info.descriptionurl.length > 800 ||
        !/^(CC0|CC BY(?:-SA)?(?: [0-9.]+)?|Public domain)$/i.test(
          meta?.LicenseShortName?.value ?? "",
        )
      )
        return [];
      return [
        {
          id: String(page.pageid),
          title: page.title.replace(/^File:/, "").slice(0, 240),
          url: info.url,
          source: info.descriptionurl,
          license: plain(meta.LicenseShortName.value),
          author: plain(meta.Artist?.value).slice(0, 240),
          width: info.width,
          height: info.height,
        },
      ];
    })
    .slice(0, 12);
}
