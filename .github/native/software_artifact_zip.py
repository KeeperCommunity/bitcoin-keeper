#!/usr/bin/env python3
"""Bounded ZIP32 receipt transport; never extract paths or grant evidence trust."""
import base64
import json
import stat
import struct
import sys
import zlib

MAX_ARCHIVE = 1048576
MAX_MEMBER = 524288
ERROR = 'SOFTWARE_ARTIFACT_ZIP_INVALID'
MEMBERS = {'IOS': 'ios/metadata.json', 'ANDROID': 'android/metadata.json'}


def _require(condition):
    if not condition:
        raise ValueError(ERROR)


def _extras(raw, central=False):
    """Only finite, non-path-bearing ZIP32 timestamp extensions are accepted."""
    seen = set()
    offset = 0
    while offset < len(raw):
        _require(offset + 4 <= len(raw))
        kind, size = struct.unpack_from('<HH', raw, offset)
        offset += 4
        _require(kind not in seen and offset + size <= len(raw))
        seen.add(kind)
        value = raw[offset:offset + size]
        if kind == 0x5455:  # Extended timestamps: local all times; central may omit access/create.
            _require(size >= 1 and 0 < value[0] <= 7)
            lengths = {1 + 4 * value[0].bit_count()}
            if central:
                lengths.add(1 + 4 * (value[0] & 1))
            _require(size in lengths)
        elif kind == 0x000a:  # NTFS reserved word + one three-FILETIME timestamp attribute.
            _require(size == 32 and value[:4] == b'\0' * 4 and
                     value[4:8] == struct.pack('<HH', 1, 24))
        else:
            # Includes ZIP64, Unicode path overrides and encrypted/AES metadata.
            raise ValueError(ERROR)
        offset += size
    _require(offset == len(raw))


def _read_archive(raw, platform):
    _require(type(raw) is bytes and type(platform) is str and platform in MEMBERS and
             22 <= len(raw) <= MAX_ARCHIVE)
    name = MEMBERS[platform].encode('ascii')
    end = len(raw) - 22
    signature, disk, start_disk, count_disk, count, central_size, central, comment = \
        struct.unpack_from('<4s4H2IH', raw, end)
    _require(signature == b'PK\x05\x06' and disk == start_disk == 0 and
             count_disk == count == 1 and comment == 0 and central >= 30 and
             central_size >= 46 and central + central_size == end)
    header = struct.unpack_from('<4s6H3I5H2I', raw, central)
    (signature, made, needed, flags, method, mtime, mdate, crc, packed, size,
     name_size, extra_size, comment_size, disk, _internal, external, local) = header
    mode = external >> 16
    _require(signature == b'PK\x01\x02' and made >> 8 in (0, 3) and
             10 <= needed <= 20 and flags & ~0x080e == 0 and method in (0, 8) and
             (method != 0 or flags & 6 == 0) and 0 < size <= MAX_MEMBER and
             0 < packed <= MAX_ARCHIVE and name_size == len(name) and
             comment_size == disk == local == 0 and
             central_size == 46 + name_size + extra_size and
             stat.S_IFMT(mode) in (0, stat.S_IFREG) and external & 0x10 == 0)
    _require(raw[central + 46:central + 46 + name_size] == name)
    _extras(raw[central + 46 + name_size:end], central=True)

    header = struct.unpack_from('<4s5H3I2H', raw, 0)
    (signature, local_needed, local_flags, local_method, local_time, local_date,
     local_crc, local_packed, local_size, local_name_size, local_extra_size) = header
    start = 30 + local_name_size + local_extra_size
    stop = start + packed
    _require(signature == b'PK\x03\x04' and local_needed == needed and local_flags == flags and
             local_method == method and local_time == mtime and local_date == mdate and
             local_name_size == name_size and start <= central and stop <= central and
             raw[30:30 + local_name_size] == name)
    _extras(raw[30 + local_name_size:start])
    if flags & 8:
        _require(local_crc in (0, crc) and local_packed in (0, packed) and local_size in (0, size))
        descriptor = raw[stop:central]
        if len(descriptor) == 16:
            _require(descriptor[:4] == b'PK\x07\x08')
            descriptor = descriptor[4:]
        _require(len(descriptor) == 12 and struct.unpack('<III', descriptor) == (crc, packed, size))
    else:
        _require(stop == central and (local_crc, local_packed, local_size) == (crc, packed, size))

    payload = raw[start:stop]
    if method == 0:
        result = payload
    else:
        inflater = zlib.decompressobj(-15)
        result = inflater.decompress(payload, MAX_MEMBER + 1)
        _require(inflater.eof and not inflater.unused_data and not inflater.unconsumed_tail)
    _require(len(result) == size and len(result) <= MAX_MEMBER and zlib.crc32(result) == crc)
    return {MEMBERS[platform]: result}


def read_archive(raw, platform):
    """Return exact original member bytes; private C2/D routes are not configured."""
    try:
        return _read_archive(raw, platform)
    except Exception:
        # No filename, content, underlying parser exception or signed URL escapes.
        raise ValueError(ERROR) from None


def main():
    try:
        _require(len(sys.argv) == 2 and sys.argv[1] in MEMBERS)
        raw = sys.stdin.buffer.read(MAX_ARCHIVE + 1)
        members = read_archive(raw, sys.argv[1])
        # IPC only: the caller captures stdout, validates bytes, and never logs this envelope.
        sys.stdout.write(json.dumps({name: base64.b64encode(value).decode('ascii')
                                    for name, value in members.items()}, separators=(',', ':')))
    except Exception:
        sys.stderr.write(ERROR + '\n')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
