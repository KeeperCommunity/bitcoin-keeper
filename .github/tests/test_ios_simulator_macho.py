"""Malformed/static Mach-O controls only; no simulator execution or signing."""
import importlib.util
from pathlib import Path
import plistlib
import struct
import unittest

SPEC = importlib.util.spec_from_file_location('simulator_macho', Path(__file__).parents[1] / 'native/ios_simulator_macho.py')
m = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(m)


def fixture(payload=None):
    payload = plistlib.dumps({'application-identifier': 'io.example.control'}) if payload is None else payload
    header = struct.pack('<8I', 0xfeedfacf, 0x0100000c, 0, 2, 1, 152, 0, 0)
    segment = struct.pack('<II16sQQQQIIII', 0x19, 152, b'__TEXT', 0, 4096, 0, 4096, 7, 5, 1, 0)
    section = struct.pack('<16s16sQQIIIIIIII', b'__entitlements', b'__TEXT', 0, len(payload), 184, 0, 0, 0, 0, 0, 0, 0)
    return header + segment + section + payload


class SimulatorMachO(unittest.TestCase):
    def test_linker_embedded_simulator_entitlements_are_distinct_from_signature_claims(self):
        value = m.inspect(fixture())[0]
        self.assertEqual(value['architecture'], 'arm64')
        self.assertTrue(value['simulator_entitlements_section_present'])
        self.assertTrue(value['application_identifier_present'])
        self.assertFalse(value['simulator_der_section_present'])

    def test_missing_sections_are_observations_not_passes(self):
        raw = struct.pack('<8I', 0xfeedfacf, 0x0100000c, 0, 2, 1, 8, 0, 0) + struct.pack('<II', 0x1b, 8)
        value = m.inspect(raw)[0]
        self.assertFalse(value['application_identifier_present'])
        self.assertFalse(value['simulator_entitlements_section_present'])

    def test_bad_offsets_truncation_and_invalid_entitlements_rejected(self):
        for raw in (fixture()[:30], fixture()[:100], fixture(b'not-a-plist'),
                    fixture(plistlib.dumps(['not-a-dict']))):
            with self.subTest(length=len(raw)), self.assertRaises((ValueError, plistlib.InvalidFileException)):
                m.inspect(raw)
        raw = bytearray(fixture()); struct.pack_into('<I', raw, 152, 2**32 - 1)
        with self.assertRaises(ValueError): m.inspect(bytes(raw))

    def test_fat_architecture_bounds_are_checked(self):
        thin = fixture()
        raw = struct.pack('>II', 0xcafebabe, 1) + struct.pack('>IIIII', 0x0100000c, 0, 28, len(thin), 0) + thin
        self.assertEqual(m.inspect(raw)[0]['architecture'], 'arm64')
        with self.assertRaises(ValueError): m.inspect(raw[:-1])


if __name__ == '__main__': unittest.main()
