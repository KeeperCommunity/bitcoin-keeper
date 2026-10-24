#!/usr/bin/env python3
"""Read one bounded metadata.json member without extracting paths or echoing errors."""
import io
import stat
import sys
import zipfile


def read_metadata(raw):
    if len(raw) > 1048576:
        raise ValueError('archive size')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = archive.infolist()
        if len(members) != 1:
            raise ValueError('single metadata file required')
        member = members[0]
        mode = member.external_attr >> 16
        if (member.filename != 'metadata.json' or member.flag_bits & 1 or
                stat.S_ISLNK(mode) or not 0 < member.file_size <= 524288):
            raise ValueError('metadata member rejected')
        with archive.open(member) as source:
            result = source.read(524289)
        if len(result) != member.file_size:
            raise ValueError('metadata size mismatch')
        return result


if __name__ == '__main__':
    try:
        with open(sys.argv[1], 'rb') as source:
            result = read_metadata(source.read(1048577))
        sys.stdout.buffer.write(result)
    except Exception:
        sys.stderr.write('Canonical metadata archive rejected.\n')
        raise SystemExit(1)
