"""Read simulator Mach-O entitlement sections without executing or modifying code."""
import hashlib
import plistlib
import struct

MAX_SECTION = 65536


def require(value):
    if not value:
        raise ValueError('Invalid bounded simulator Mach-O.')


def inspect(raw, depth=0):
    require(depth <= 1)
    require(type(raw) is bytes and 32 <= len(raw) <= 512 * 1024 * 1024)
    if raw[:4] == b'\xca\xfe\xba\xbe':
        count = struct.unpack_from('>I', raw, 4)[0]
        require(0 < count <= 8 and 8 + count * 20 <= len(raw))
        result = []
        for index in range(count):
            _, _, offset, size, _ = struct.unpack_from('>IIIII', raw, 8 + index * 20)
            require(offset >= 8 + count * 20 and size >= 32 and offset + size <= len(raw))
            result.extend(inspect(raw[offset:offset + size], depth + 1))
        return result
    require(raw[:4] == b'\xcf\xfa\xed\xfe')
    _, cpu, subtype, kind, count, commands_size, _, _ = struct.unpack_from('<8I', raw)
    require(cpu in (0x01000007, 0x0100000c) and 0 < count <= 4096 and 32 + commands_size <= len(raw))
    position, sections, versions = 32, {}, []
    for _ in range(count):
        require(position + 8 <= 32 + commands_size)
        command, size = struct.unpack_from('<II', raw, position)
        require(size >= 8 and position + size <= 32 + commands_size)
        if command == 0x19:
            require(size >= 72)
            segment = raw[position + 8:position + 24].split(b'\0')[0]
            n = struct.unpack_from('<I', raw, position + 64)[0]
            require(size == 72 + n * 80)
            for index in range(n):
                at = position + 72 + index * 80
                name = raw[at:at + 16].split(b'\0')[0]
                if segment == b'__TEXT' and name in (b'__entitlements', b'__ents_der'):
                    length, offset = struct.unpack_from('<QI', raw, at + 40)
                    require(name not in sections and 0 < length <= MAX_SECTION and
                            offset >= 32 + commands_size and offset + length <= len(raw))
                    sections[name] = raw[offset:offset + length]
        elif command == 0x32:
            require(size >= 24)
            platform, minimum, sdk, _ = struct.unpack_from('<4I', raw, position + 8)
            version = lambda value: '%d.%d.%d' % (value >> 16, (value >> 8) & 255, value & 255)
            versions.append({'platform': platform, 'minimum_os': version(minimum), 'sdk': version(sdk)})
        position += size
    require(position == 32 + commands_size)
    xml = sections.get(b'__entitlements')
    entitlements = plistlib.loads(xml.rstrip(b'\0')) if xml is not None else {}
    require(type(entitlements) is dict)
    return [{'architecture': 'arm64' if cpu == 0x0100000c else 'x86_64', 'cpu_subtype': subtype,
        'mach_o_type': kind, 'build_versions': versions,
        'simulator_entitlements_section_present': xml is not None,
        'simulator_der_section_present': b'__ents_der' in sections,
        'simulator_entitlement_keys': sorted(entitlements),
        'application_identifier': entitlements.get('application-identifier')
            if type(entitlements.get('application-identifier')) is str else None,
        'application_identifier_present': type(entitlements.get('application-identifier')) is str and
            bool(entitlements['application-identifier']),
        'simulator_entitlements_sha256': hashlib.sha256(xml).hexdigest() if xml is not None else None}]
