#!/usr/bin/env python3
"""Reap only CPU-spinning, disconnected ubuntu login shells; fail closed."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import pwd
import signal
import time

STATE = Path('/run/orphan-login-shell-guard')
HZ = os.sysconf('SC_CLK_TCK')


def qualifies(s, uid):
    return (s['uid'] == uid and s['ppid'] == 1 and s['exe'] == '/usr/bin/bash'
            and s['argv'] in ([b'-bash'], [b'bash']) and not s['children']
            and s['tty'] != 0 and s['age'] >= 300
            and s['fds'][0] == s['fds'][1] == s['fds'][2]
            and s['fds'][0].startswith('/dev/pts/')
            and s['fds'][0].endswith(' (deleted)')
            and s['cgroup'].startswith('0::/user.slice/user-')
            and '/session-' in s['cgroup'])


def snapshot(pid):
    p = Path('/proc') / str(pid)
    fields = (p / 'stat').read_text().rsplit(')', 1)[1].split()
    start = int(fields[19])
    return dict(pid=pid, start=start, uid=p.stat().st_uid,
                ppid=int(fields[1]), tty=int(fields[4]),
                ticks=int(fields[11]) + int(fields[12]),
                age=float(Path('/proc/uptime').read_text().split()[0]) - start / HZ,
                exe=os.readlink(p / 'exe'),
                argv=(p / 'cmdline').read_bytes().rstrip(b'\0').split(b'\0'),
                children=(p / 'task' / str(pid) / 'children').read_text().strip(),
                fds=[os.readlink(p / 'fd' / str(n)) for n in range(3)],
                cgroup=(p / 'cgroup').read_text().strip())


def accumulated(s, old, now):
    if not old or old['start'] != s['start']:
        return 0
    dt = now - old['time']
    if not 30 <= dt <= 180:
        return 0
    cpu = (s['ticks'] - old['ticks']) / HZ / dt
    return old.get('high_seconds', 0) + dt if cpu >= .8 else 0


def reap(s, uid):
    # pidfd binds signals to this process, including across PID reuse races.
    fd = os.pidfd_open(s['pid'])
    try:
        for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGKILL):
            current = snapshot(s['pid'])
            if current['start'] != s['start'] or not qualifies(current, uid):
                return
            signal.pidfd_send_signal(fd, sig)
            print(f'orphan-login-shell pid={s["pid"]} signal={sig.name}', flush=True)
            if sig != signal.SIGKILL:
                time.sleep(1)
    finally:
        os.close(fd)


def self_test():
    s = dict(uid=1000, ppid=1, exe='/usr/bin/bash', argv=[b'-bash'],
             children='', tty=34818, age=1000, fds=['/dev/pts/2 (deleted)'] * 3,
             cgroup='0::/user.slice/user-1000.slice/session-2.scope', start=10,
             ticks=6000)
    assert qualifies(s, 1000)
    for change in (dict(uid=0), dict(ppid=5), dict(argv=[b'bash', b'job.sh']),
                   dict(children='123'), dict(tty=0), dict(age=10),
                   dict(fds=['/dev/pts/2'] * 3), dict(exe='/usr/bin/node'),
                   dict(cgroup='0::/system.slice/docker.service')):
        assert not qualifies(s | change, 1000), change
    old = dict(start=10, ticks=0, time=0, high_seconds=240)
    busy = s | dict(ticks=HZ * 60)
    assert accumulated(busy, old, 60) == 300
    assert accumulated(busy | dict(start=11), old, 60) == 0
    assert accumulated(busy | dict(ticks=0), old, 60) == 0
    assert accumulated(busy, old, 300) == 0
    print('PASS: detached-shell selection, active-work exclusions, CPU window, PID reuse')


def run(dry_run):
    uid = pwd.getpwnam('ubuntu').pw_uid
    if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        raise RuntimeError('pidfd support required; no signals sent')
    if dry_run:
        for p in Path('/proc').glob('[0-9]*'):
            try:
                s = snapshot(int(p.name))
                if qualifies(s, uid):
                    print(f'candidate pid={s["pid"]}')
            except (OSError, ValueError, IndexError):
                pass
        print('dry-run complete: no signals sent, no state changed')
        return
    STATE.mkdir(mode=0o700, exist_ok=True)
    with (STATE / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = STATE / 'state.json'
        try:
            old = json.loads(path.read_text())
        except (OSError, ValueError):
            old = {}
        now = time.monotonic()
        fresh = {}
        for p in Path('/proc').glob('[0-9]*'):
            try:
                s = snapshot(int(p.name))
                if not qualifies(s, uid):
                    continue
                high = accumulated(s, old.get(p.name), now)
                if high >= 300:
                    reap(s, uid)
                else:
                    fresh[p.name] = dict(start=s['start'], ticks=s['ticks'],
                                         time=now, high_seconds=high)
            except (OSError, ValueError, IndexError):
                continue
        temp = STATE / 'state.tmp'
        temp.write_text(json.dumps(fresh))
        os.chmod(temp, 0o600)
        temp.replace(path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    self_test() if args.self_test else run(args.dry_run)
