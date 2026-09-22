#!/usr/bin/env python3
"""Copy the complete skill to an explicitly chosen skills directory."""
import argparse
from pathlib import Path
import shutil
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dest', required=True, help='Parent skills directory; never inferred')
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    destination = Path(args.dest).expanduser().resolve() / source.name
    if any(path.is_symlink() for path in source.rglob('*')):
        parser.error('Source skill contains symlinks; inspect the package before installing.')
    if destination.exists() or destination.is_symlink():
        parser.error('Destination exists; review and move the old installation before updating.')
    if source == destination or source in destination.parents:
        parser.error('Destination must not be within the source skill.')
    try:
        shutil.copytree(source, destination, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    except OSError as exc:
        print('Install failed: ' + str(exc), file=sys.stderr)
        return 1
    print(str(destination / 'SKILL.md'))
    print('Installation copied. Confirm discovery or explicitly load SKILL.md in your agent.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
