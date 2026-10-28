"""Debug-only loopback fixtures must not broaden the Release policy."""
import copy
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
ROOT = Path(__file__).resolve().parents[2]
class AndroidDebugLoopbackPolicy(unittest.TestCase):
    def test_debug_adds_only_exact_ipv4_loopback_to_existing_policy(self):
        main = ET.parse(ROOT / 'android/app/src/main/res/xml/network_security_config.xml').getroot()
        debug = ET.parse(ROOT / 'android/app/src/debug/res/xml/network_security_config.xml').getroot()
        additions = [row for row in debug.findall('./domain-config/domain') if row.text == '127.0.0.1']
        self.assertEqual(len(additions), 1)
        self.assertEqual(additions[0].attrib, {'includeSubdomains': 'false'})
        debug.find('domain-config').remove(additions[0])
        def canonical(node):
            return (node.tag, sorted(node.attrib.items()), (node.text or '').strip(), [canonical(child) for child in node])
        self.assertEqual(canonical(main), canonical(debug))
    def test_release_does_not_gain_loopback_or_user_certificate_trust(self):
        main = ET.parse(ROOT / 'android/app/src/main/res/xml/network_security_config.xml').getroot()
        self.assertNotIn('127.0.0.1', [row.text for row in main.iter('domain')])
        self.assertFalse(list(main.iter('debug-overrides')))
        self.assertFalse(list(main.iter('trust-anchors')))
        manifest = (ROOT / 'android/app/src/main/AndroidManifest.xml').read_text()
        self.assertIn('android:networkSecurityConfig="@xml/network_security_config"', manifest)
if __name__ == '__main__': unittest.main()
