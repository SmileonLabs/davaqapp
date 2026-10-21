#!/usr/bin/env python3
"""Verify every ARM64 library's 16 KB ELF LOAD alignment in a release APK."""
import struct
import sys
import zipfile


def verify_elf(data, name):
    if len(data) < 64 or data[:6] != b"\x7fELF\x02\x01":
        raise ValueError("Expected little-endian ELF64: " + name)
    if struct.unpack_from("<H", data, 18)[0] != 183:
        raise ValueError("Expected ARM64 machine: " + name)
    offset = struct.unpack_from("<Q", data, 32)[0]
    size, count = struct.unpack_from("<HH", data, 54)
    if size < 56 or offset + size * count > len(data):
        raise ValueError("Invalid program headers: " + name)
    loads = 0
    for index in range(count):
        header = offset + index * size
        if struct.unpack_from("<I", data, header)[0] != 1:
            continue
        loads += 1
        file_offset, address = struct.unpack_from("<QQ", data, header + 8)
        alignment = struct.unpack_from("<Q", data, header + 48)[0]
        if alignment < 16384 or address % 16384 != file_offset % 16384:
            raise ValueError("16 KB LOAD alignment failed: " + name)
    if not loads:
        raise ValueError("No LOAD segments: " + name)


def main():
    checked = 0
    with zipfile.ZipFile(sys.argv[1]) as archive:
        for name in archive.namelist():
            if name.startswith("lib/arm64-v8a/") and name.endswith(".so"):
                verify_elf(archive.read(name), name)
                checked += 1
    if not checked:
        raise ValueError("No ARM64 native libraries found")
    print("ELF alignment passed: %d ARM64 libraries support 16 KB LOAD alignment." % checked)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile, IndexError) as error:
        raise SystemExit("APK ELF verification failed: " + str(error))
