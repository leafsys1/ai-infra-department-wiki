"""Validate distributable skill structure and all local documentation links."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / 'skills' / 'inference-delivery-qa'


class SkillPackage(unittest.TestCase):
    def test_portable_frontmatter(self):
        text = (SKILL / 'SKILL.md').read_text(encoding='utf-8')
        self.assertTrue(text.startswith('---\n'))
        front, body = text[4:].split('\n---\n', 1)
        fields = dict(re.findall(r'^(\w+): (.+)$', front, re.M))
        self.assertEqual(fields['name'], SKILL.name)
        self.assertLessEqual(len(fields['name']), 64)
        self.assertTrue(1 <= len(fields['description']) <= 1024)
        self.assertLessEqual(len(fields['compatibility']), 500)
        self.assertTrue(body.strip())
        self.assertLess(len(text.splitlines()), 500)

    def test_local_links_resolve(self):
        for file in SKILL.rglob('*.md'):
            if '.git' in file.parts:
                continue
            for link in re.findall(r'\]\(([^)]+)\)', file.read_text(encoding='utf-8')):
                if '://' in link or link.startswith('#'):
                    continue
                target = file.parent / link.split('#', 1)[0]
                self.assertTrue(target.exists(), '{} -> {}'.format(file, link))


if __name__ == '__main__':
    unittest.main()
