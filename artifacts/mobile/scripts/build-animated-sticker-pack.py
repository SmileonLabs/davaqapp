"""Build a small, offline animated Noto pack. Requires Python + Pillow WebP support.
Run with --catalog <downloaded official data/api.json>. Network is only used here,
never when opening the bundled picker. See assets/animated-stickers/NOTICE.txt.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import re
import time
import urllib.request
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CATALOG_URL = 'https://googlefonts.github.io/noto-emoji-animation/data/api.json'
CATEGORIES = {
    'Smileys and emotions': ('표정·마음', 48, '표정 기분 감정 웃음 사랑 하트 손 인사'),
    'Animals and nature': ('동물·자연', 32, '동물 자연 강아지 고양이 꽃 나무'),
    'Food and drink': ('음식', 24, '음식 과일 먹기 음료 커피 디저트'),
    'Activities and events': ('축하·활동', 24, '축하 생일 파티 운동 놀이'),
    'Objects': ('사물', 24, '사물 물건 선물 음악 도구'),
    'Symbols': ('기호', 16, '기호 표시 하트 숫자'),
    'Travel and places': ('여행', 16, '여행 날씨 장소 자동차 비행기'),
    'People': ('사람', 8, '사람 춤 달리기'),
    'Flags': ('깃발', 4, '깃발'),
}

def optimize(data):
    original = Image.open(io.BytesIO(data))
    if original.format != 'WEBP' or getattr(original, 'n_frames', 1) < 2:
        raise ValueError('not an animated WebP')
    frames, durations = [], []
    pending, duration = None, 0
    original_duration = 0
    for index in range(original.n_frames):
        original.seek(index)
        original.load()
        if pending is None:
            pending = original.convert('RGBA').resize((128, 128), Image.Resampling.LANCZOS)
        frame_duration = original.info.get('duration', 40)
        original_duration += frame_duration
        duration += frame_duration
        if duration >= 50 or index == original.n_frames - 1:
            frames.append(pending)
            durations.append(duration)
            pending, duration = None, 0
    output = io.BytesIO()
    frames[0].save(output, format='WEBP', save_all=True, append_images=frames[1:],
                   duration=durations, loop=0, quality=72, method=4)
    result = output.getvalue()
    checked = Image.open(io.BytesIO(result))
    if checked.n_frames < 2:
        raise ValueError('optimization lost animation')
    checked_duration = 0
    for index in range(checked.n_frames):
        checked.seek(index); checked.load()
        checked_duration += checked.info.get('duration', 0)
    if checked_duration != original_duration:
        raise ValueError('animation duration changed')
    return result, checked.n_frames, original_duration

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalog', required=True)
    parser.add_argument('--output-report', required=True)
    args = parser.parse_args()
    metadata = json.loads(Path(args.catalog).read_text())
    old = (ROOT / 'constants/stickers.ts').read_text()
    # Once generated, reuse the curated recommendations for repeatable rebuilds.
    old_codes = re.findall(r'"([0-9a-f_]+)"', old.split('] as const')[0])
    previous = ROOT / 'constants/animatedStickers.ts'
    if previous.exists():
        old_codes = re.findall(r'"?code"?\s*:\s*"([0-9a-f_]+)"', previous.read_text())[:40] or old_codes
    by_code = {icon['codepoint']: icon for icon in metadata['icons']}
    selected = list(dict.fromkeys(code for code in old_codes if code in by_code))
    for category, (_, limit, _) in CATEGORIES.items():
        candidates = [icon['codepoint'] for icon in metadata['icons'] if category in icon['categories']
                      and 'Animated Emoji' not in icon.get('unsupported_families', [])
                      and not any(0x1f3fb <= int(part, 16) <= 0x1f3ff for part in icon['codepoint'].split('_'))]
        selected.extend(code for code in candidates[:limit] if code not in selected)
    destination = ROOT / 'assets/animated-stickers'
    destination.mkdir(parents=True, exist_ok=True)
    def build(code):
        started = time.monotonic()
        url = f'https://fonts.gstatic.com/s/e/notoemoji/latest/{code}/512.webp'
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=30) as response:
                    data = response.read()
                result, frames, duration = optimize(data)
                (destination / f'{code}.webp').write_bytes(result)
                icon = by_code[code]
                category, _, keywords = CATEGORIES[icon['categories'][0]]
                return {'code': code, 'label': icon['tags'][0].strip(':'), 'category': category,
                        'keywords': keywords + ' ' + ' '.join(icon['tags']),
                        'originalBytes': len(data), 'bytes': len(result), 'frames': frames,
                        'durationMs': duration, 'elapsedMs': round((time.monotonic()-started)*1000),
                        'sha256': hashlib.sha256(result).hexdigest()}
            except Exception:
                if attempt == 2: raise
                time.sleep(attempt + 1)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(build, selected))
    source = '// Generated by scripts/build-animated-sticker-pack.py; Noto Animated Emoji, CC BY 4.0.\n'
    source += 'export const ANIMATED_STICKERS = ' + json.dumps([{k:r[k] for k in ['code','label','category','keywords']} for r in records],ensure_ascii=False,indent=2) + ' as const;\n'
    source += 'export const ANIMATED_STICKER_SOURCES: Record<string, number> = {\n'
    source += ''.join(f'  "{r["code"]}": require("../assets/animated-stickers/{r["code"]}.webp"),\n' for r in records)
    source += '};\n'
    (ROOT / 'constants/animatedStickers.ts').write_text(source)
    Path(args.output_report).write_text(json.dumps({'catalogUrl': CATALOG_URL,
        'count':len(records),'originalBytes':sum(r['originalBytes'] for r in records),
        'bundledBytes':sum(r['bytes'] for r in records),'items':records},ensure_ascii=False,indent=2))
    print(json.dumps({'count':len(records),'originalBytes':sum(r['originalBytes'] for r in records),'bundledBytes':sum(r['bytes'] for r in records)}))

if __name__ == '__main__': main()
