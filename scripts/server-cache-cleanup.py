#!/usr/bin/env python3
"""Bounded cleanup of regenerable caches; never prune volumes or tagged images."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

STATE = Path('/var/lib/server-cache-cleanup')
DIR_NAME = re.compile(r'davaq-(?:group(?:-r\d+)?-\d{8}|web-\d{8}|photo-(?:heic|recovery|cache)-\d{8}|scroll-stable-\d{8}|social-r\d+|apple-r\d+|media-policy-r\d+|tcg-\d{8})')
ARCHIVE_NAME = re.compile(r'davaq-(?:web|api|landing|call-fix|push-api|tcg|photo-cache)[a-zA-Z0-9._-]*\.tar\.gz')


def overlaps(a, b):
    return a == b or a in b.parents or b in a.parents


def eligible(p, protected, now):
    if not (DIR_NAME.fullmatch(p.name) or ARCHIVE_NAME.fullmatch(p.name)):
        return False
    if p.is_symlink() or any(overlaps(p, q) for q in protected):
        return False
    cutoff = now - 14 * 86400
    if p.stat().st_mtime > cutoff:
        return False
    if p.is_file():
        return True
    if not p.is_dir() or not DIR_NAME.fullmatch(p.name):
        return False
    count = 0
    for root, dirs, files in os.walk(p, followlinks=False):
        for name in dirs + files:
            q = Path(root) / name
            count += 1
            if count > 100000 or q.is_symlink() or q.stat().st_mtime > cutoff:
                return False
            if q.stat().st_dev != p.stat().st_dev:
                return False
    return True


def command(cmd, timeout=300):
    # Keep pruning output bounded and do not leave output files behind.
    with tempfile.TemporaryFile() as output:
        r = subprocess.run(cmd, stdout=output, stderr=subprocess.STDOUT, timeout=timeout)
        output.seek(0, os.SEEK_END)
        output.seek(max(0, output.tell() - 1500))
        text = output.read().decode(errors='replace').strip()
        print(json.dumps(dict(command=cmd[:3], code=r.returncode, summary=text)), flush=True)
        if r.returncode:
            raise RuntimeError(f'cleanup command failed: {cmd[:3]}')


def builder_command(age, help_text):
    cmd = ['docker', 'builder', 'prune', '-af', '--filter', f'until={age}']
    if '--reserved-space' in help_text:
        return cmd + ['--reserved-space', '2GB', '--max-used-space', '4GB']
    if '--keep-storage' in help_text:
        return cmd + ['--keep-storage', '2GB']
    raise RuntimeError('Docker cache retention option unavailable; cleanup skipped')


def protected_paths():
    ids = subprocess.check_output(['docker', 'ps', '-aq'], text=True, timeout=30).split()
    containers = json.loads(subprocess.check_output(['docker', 'inspect', *ids], timeout=60)) if ids else []
    paths = [Path(m['Source']).resolve() for c in containers for m in c.get('Mounts', [])]
    for proc in Path('/proc').glob('[0-9]*'):
        for q in [proc / 'cwd', *(proc / 'fd').glob('*')]:
            try:
                raw = os.readlink(q)
                if raw.startswith('/tmp/'):
                    paths.append(Path(raw.removesuffix(' (deleted)')).resolve())
            except (OSError, RuntimeError):
                pass
    return paths


def self_test():
    with tempfile.TemporaryDirectory() as name:
        root = Path(name)
        now = time.time()
        old = now - 15 * 86400
        p = root / 'davaq-web-20261001'
        p.mkdir()
        f = p / 'payload.txt'
        f.write_text('old deployment fixture')
        for q in [f, p]:
            os.utime(q, (old, old))
        assert eligible(p, [], now)
        assert not eligible(p, [f], now)  # mounted/open nested file
        assert not eligible(p, [root], now)  # protected ancestor
        os.utime(f, (now, now))
        assert not eligible(p, [], now)  # recently used payload
        os.utime(f, (old, old))
        (p / 'link').symlink_to('/var/lib/tcgindex')
        os.utime(p, (old, old))
        assert not eligible(p, [], now)
        for text in ['davaq-secrets', 'tcgindex', 'davaq-uploads', 'random-cache']:
            assert not DIR_NAME.fullmatch(text)
        assert ARCHIVE_NAME.fullmatch('davaq-web-design-r10.tar.gz')
        assert not ARCHIVE_NAME.fullmatch('davaq-apple-key.p8')
        assert '--reserved-space' in builder_command('168h', '--reserved-space')
        assert '--keep-storage' in builder_command('24h', '--keep-storage')
    print('PASS: active paths, recent files, symlinks, data and key exclusions')


def main(dry_run):
    now = time.time()
    disk = shutil.disk_usage('/')
    used = 100 * disk.used / disk.total
    if not dry_run:
        STATE.mkdir(mode=0o700, exist_ok=True)
    # Dry-run must not create state or acquire a destructive-work lock.
    if dry_run:
        paths = protected_paths()
        candidates = [str(p) for p in Path('/tmp').iterdir() if eligible(p, paths, now)]
        print(json.dumps(dict(dry_run=True, used_percent=round(used, 1),
                              temp_candidates=candidates, signals_or_deletions=0)))
        return
    with (STATE / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stamp = STATE / 'last-success'
        last = float(stamp.read_text()) if stamp.exists() else 0
        if used < 80 and now - last < 86400:
            print(f'healthy disk {used:.1f}%; daily cleanup not due')
            return
        print(f'cleanup start used={used:.1f}% free={disk.free}', flush=True)
        # Docker itself excludes cache currently in use. Keep recent/hot cache.
        age = '1h' if used >= 80 else '168h'
        help_text = subprocess.check_output(['docker', 'builder', 'prune', '--help'],
                                            text=True, timeout=30)
        command(builder_command(age, help_text), timeout=600)
        # No -a: tagged rollback images and containers remain protected.
        command(['docker', 'image', 'prune', '-f', '--filter', 'until=168h'])
        command(['apt-get', 'clean'], timeout=60)
        deleted = []
        for p in Path('/tmp').iterdir():
            if len(deleted) >= 20:
                break
            if not (DIR_NAME.fullmatch(p.name) or ARCHIVE_NAME.fullmatch(p.name)):
                continue
            # Refresh usage exclusions immediately before each deletion.
            if eligible(p, protected_paths(), time.time()):
                shutil.rmtree(p) if p.is_dir() else p.unlink()
                deleted.append(p.name)
        stamp.write_text(str(time.time()))
        after = shutil.disk_usage('/')
        print(json.dumps(dict(deleted_temporary_items=deleted, free_bytes=after.free,
                              net_freed_bytes=after.free - disk.free)), flush=True)
        if after.used / after.total >= .9:
            print('WARNING: disk remains above 90%; protected data was not deleted', flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--self-test', action='store_true')
    args = p.parse_args()
    self_test() if args.self_test else main(args.dry_run)
