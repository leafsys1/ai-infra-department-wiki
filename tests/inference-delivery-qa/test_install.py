"""Installation tests; temporary copies only, no user agent config touched."""
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

PACKAGE = pathlib.Path(__file__).resolve().parents[2] / 'skills' / 'inference-delivery-qa'
ROOT = PACKAGE


class Installation(unittest.TestCase):
    def test_rejects_symlink_in_package(self):
        with tempfile.TemporaryDirectory() as tmp:
            copy = pathlib.Path(tmp) / 'package'
            shutil.copytree(ROOT, copy / 'skills' / 'inference-delivery-qa')
            shutil.copy2(ROOT / 'install.py', copy / 'install.py')
            skill = copy / 'skills' / 'inference-delivery-qa'
            try:
                (skill / 'external-link').symlink_to(ROOT / 'README.md')
            except OSError:
                self.skipTest('symlinks unavailable on this host')
            dest = pathlib.Path(tmp) / 'installed'
            result = subprocess.run([sys.executable, str(copy / 'install.py'),
                                     '--dest', str(dest)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((dest / 'inference-delivery-qa').exists())

    def test_explicit_destination_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            command = [sys.executable, str(ROOT / 'install.py'), '--dest', tmp]
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            installed = pathlib.Path(tmp) / 'inference-delivery-qa'
            self.assertEqual((installed / 'SKILL.md').read_bytes(),
                             (ROOT / 'SKILL.md').read_bytes())
            marker = installed / 'local-note.txt'
            marker.write_text('preserve', encoding='utf-8')
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual(marker.read_text(), 'preserve')


if __name__ == '__main__':
    unittest.main()
