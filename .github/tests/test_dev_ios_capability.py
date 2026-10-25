"""Development target capability parity; not a simulator launch-cause proof."""
import os
from pathlib import Path
import plistlib
import re
import unittest

ROOT = Path(os.environ.get('KEEPER_CAPABILITY_SOURCE_ROOT',
    Path(__file__).resolve().parents[2]))


class DevelopmentCapability(unittest.TestCase):
    def test_active_modern_development_target_uses_production_cpu_capability(self):
        project = (ROOT / 'ios/hexa_keeper.xcodeproj/project.pbxproj').read_text()
        blocks = re.findall(r'buildSettings = \{(.*?)\n\s*\};', project, re.DOTALL)
        active = [block for block in blocks
            if 'INFOPLIST_FILE = "hexa_keeper_dev-Info.plist";' in block and
               'PRODUCT_BUNDLE_IDENTIFIER = io.hexawallet.hexakeeper.dev;' in block]
        self.assertEqual(len(active), 2, 'bind Debug/Release development configurations')
        for block in active:
            target = re.search(r'IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);', block)
            self.assertIsNotNone(target)
            self.assertGreaterEqual(tuple(map(int, target[1].split('.'))), (11, 0))
        dev = plistlib.loads((ROOT / 'ios/hexa_keeper_dev-Info.plist').read_bytes())
        production = plistlib.loads((ROOT / 'ios/hexa_keeper/Info.plist').read_bytes())
        self.assertEqual(production['UIRequiredDeviceCapabilities'], ['arm64'])
        self.assertEqual(dev['UIRequiredDeviceCapabilities'],
            production['UIRequiredDeviceCapabilities'],
            'a modern development target must not retain the legacy armv7 requirement')


if __name__ == '__main__':
    unittest.main()
