#!/usr/bin/env python3
"""Finite D13 ZIP32 transport. Return original bytes; never extract or grant trust."""
import base64
import json
import stat
import struct
import sys
import zlib

MAX_ARCHIVE = MAX_TOTAL = 12 * 1024 * 1024
ERROR = 'PRIVATE_SOFTWARE_ARTIFACT_ZIP_INVALID'
PLATFORMS = ('IOS', 'ANDROID')


def member_limits(platform):
    """Fixed D448 profile, in canonical return order, without caller overrides."""
    _require(type(platform) is str and platform in PLATFORMS)
    p = platform.lower()
    return {
        f'control/artifacts/native-integration/{p}/metadata.json': 2000000,
        f'control/artifacts/native-integration/{p}/startup.json': 2000000,
        f'control/artifacts/native-protected/{p}/metadata.json': 32768,
        f'control/artifacts/native-protected/{p}/fixture.json': 8192,
        f'control/artifacts/native-recovery/{p}/metadata.json': 32768,
        f'control/artifacts/native-recovery/{p}/fixture.json': 8192,
        f'control/artifacts/native-account/{p}/metadata.json': 32768,
        f'control/artifacts/native-account/{p}/fixture.json': 8192,
        'control/artifacts/native-protected/mongo.json': 8192,
        f'app/artifacts/native/{p}/metadata.json': 2000000,
        f'control/artifacts/native-integration/{p}/public-probe.json': 2000000,
        f'control/artifacts/native-integration/{p}/public-features.json': 2000000,
        f'control/artifacts/native-integration/{p}/public-product.json': 2000000,
    }


def _require(condition):
    if not condition:
        raise ValueError(ERROR)


def _extras(raw, central=False):
    """Only bounded, non-path-bearing ZIP32 timestamp extensions are accepted."""
    offset, seen = 0, set()
    while offset < len(raw):
        _require(offset + 4 <= len(raw))
        kind, size = struct.unpack_from('<HH', raw, offset)
        offset += 4
        _require(kind not in seen and offset + size <= len(raw))
        seen.add(kind)
        value = raw[offset:offset + size]
        if kind == 0x5455:
            _require(size >= 1 and 0 < value[0] <= 7)
            lengths = {1 + 4 * value[0].bit_count()}
            if central:
                lengths.add(1 + 4 * (value[0] & 1))
            _require(size in lengths)
        elif kind == 0x000a:
            _require(size == 32 and value[:4] == b'\0' * 4 and
                     value[4:8] == struct.pack('<HH', 1, 24))
        else:
            # Includes ZIP64, Unicode path overrides and encrypted/AES metadata.
            raise ValueError(ERROR)
        offset += size
    _require(offset == len(raw))


def _directory(raw, limits):
    end = len(raw) - 22
    signature, disk, start_disk, disk_count, count, length, start, comment = \
        struct.unpack_from('<4s4H2IH', raw, end)
    _require(signature == b'PK\x05\x06' and disk == start_disk == comment == 0 and
             disk_count == count == len(limits) and start >= 30 and
             length >= 46 * count and start + length == end)
    cursor, total, entries, seen = start, 0, [], set()
    for _ in range(count):
        _require(cursor + 46 <= end)
        fields = struct.unpack_from('<4s6H3I5H2I', raw, cursor)
        (signature, made, needed, flags, method, mtime, mdate, crc, packed, size,
         namesize, extrasize, commentsize, disk, _internal, external, local) = fields
        stop = cursor + 46 + namesize + extrasize
        _require(stop <= end)
        name = raw[cursor + 46:cursor + 46 + namesize].decode('ascii')
        mode = external >> 16
        _require(signature == b'PK\x01\x02' and name in limits and name not in seen and
                 made >> 8 in (0, 3) and 10 <= needed <= 20 and
                 flags & ~0x080e == 0 and method in (0, 8) and
                 (method != 0 or flags & 6 == 0) and 0 < size <= limits[name] and
                 0 < packed <= MAX_ARCHIVE and commentsize == disk == 0 and
                 stat.S_IFMT(mode) in (0, stat.S_IFREG) and external & 0x10 == 0)
        _extras(raw[cursor + 46 + namesize:stop], central=True)
        seen.add(name)
        total += size
        _require(total <= MAX_TOTAL)
        entries.append((name, needed, flags, method, mtime, mdate, crc, packed, size, local))
        cursor = stop
    _require(cursor == end and seen == set(limits))
    return start, entries


def _member(raw, entry, following, cap):
    name, needed, flags, method, mtime, mdate, crc, packed, size, local = entry
    _require(local + 30 <= following)
    fields = struct.unpack_from('<4s5H3I2H', raw, local)
    (signature, version, local_flags, local_method, local_time, local_date,
     local_crc, local_packed, local_size, namesize, extrasize) = fields
    start = local + 30 + namesize + extrasize
    stop = start + packed
    _require(signature == b'PK\x03\x04' and version == needed and local_flags == flags and
             local_method == method and local_time == mtime and local_date == mdate and
             start <= following and stop <= following and
             raw[local + 30:local + 30 + namesize] == name.encode('ascii'))
    _extras(raw[local + 30 + namesize:start])
    if flags & 8:
        _require(local_crc in (0, crc) and local_packed in (0, packed) and local_size in (0, size))
        descriptor = raw[stop:following]
        if len(descriptor) == 16:
            _require(descriptor[:4] == b'PK\x07\x08')
            descriptor = descriptor[4:]
        _require(len(descriptor) == 12 and struct.unpack('<III', descriptor) == (crc, packed, size))
    else:
        _require(stop == following and (local_crc, local_packed, local_size) == (crc, packed, size))
    payload = raw[start:stop]
    if method == 0:
        result = payload
    else:
        inflater = zlib.decompressobj(-15)
        result = inflater.decompress(payload, cap + 1)
        _require(inflater.eof and not inflater.unused_data and not inflater.unconsumed_tail)
    _require(len(result) == size and len(result) <= cap and zlib.crc32(result) == crc)
    return result


def _read_archive(raw, platform):
    limits = member_limits(platform)
    _require(type(raw) is bytes and 22 <= len(raw) <= MAX_ARCHIVE)
    central, entries = _directory(raw, limits)
    cursor, total, originals = 0, 0, {}
    for index, entry in enumerate(entries):
        name, *_, local = entry
        following = entries[index + 1][-1] if index + 1 < len(entries) else central
        # Any physical name permutation is valid; central order must describe every
        # contiguous local record exactly, without prefix, gaps, overlap or hidden tail.
        _require(local == cursor and local < following <= central)
        original = _member(raw, entry, following, limits[name])
        total += len(original)
        _require(total <= MAX_TOTAL)
        originals[name] = original
        cursor = following
    _require(cursor == central)
    return {name: originals[name] for name in limits}


def read_archive(raw, platform):
    """Return thirteen original buffers. This function authenticates no evidence."""
    try:
        return _read_archive(raw, platform)
    except Exception:
        raise ValueError(ERROR) from None


def main():
    try:
        _require(len(sys.argv) == 2 and sys.argv[1] in PLATFORMS)
        members = read_archive(sys.stdin.buffer.read(MAX_ARCHIVE + 1), sys.argv[1])
        # Captured IPC only. A caller must not log this envelope or treat it as trust.
        sys.stdout.write(json.dumps({name: base64.b64encode(value).decode('ascii')
                                    for name, value in members.items()}, separators=(',', ':')))
    except Exception:
        sys.stderr.write(ERROR + '\n')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
