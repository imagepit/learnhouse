from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import backup


class CaptureTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.staging = self.root / 'staging'
        self.source = self.root / 'source'
        self.staging.mkdir()
        self.source.mkdir()
        self.file = self.source / 'file.png'
        self.file.write_bytes(b'example content')
        self.catalog = self.root / 'catalog.json'
        self.catalog.write_text(json.dumps({'version': 1, 'images': [{}]}))
        self.now = datetime.now(timezone.utc)

    def command(self, args, reason):
        if args[0] == 'pg_dump':
            Path(args[-1]).write_bytes(b'example dump')

    def test_captures_archive_with_deployed_catalog_shape(self):
        with patch.object(backup, 'run', self.command), patch.object(backup, 'emit'):
            backup.capture(self.staging, self.source, self.catalog, self.now)
        name = backup.select(self.staging, self.now + timedelta(seconds=1), None)
        generation = self.staging / name
        data = backup.marker((generation / backup.COMPLETE).read_bytes(), name)
        self.assertEqual(data['catalogEntries'], 1)
        self.assertEqual(data['contentFiles'], 1)
        self.assertEqual(data['archive'], backup.record(generation / backup.ARCHIVE))
        with tarfile.open(generation / backup.ARCHIVE) as archive:
            restored = self.root / 'restored'
            expected = backup.extract_archive(archive, restored)
            self.assertEqual(backup.inventory(restored / 'content'), expected)
            self.assertEqual(expected, backup.inventory(self.source))
            with archive.extractfile('catalog.json') as catalog:
                self.assertEqual(catalog.read(), self.catalog.read_bytes())

    def test_change_during_database_dump_does_not_publish(self):
        def change(args, reason):
            self.command(args, reason)
            if args[0] == 'pg_dump':
                self.file.write_bytes(b'changed')

        with patch.object(backup, 'run', change):
            with self.assertRaisesRegex(backup.BackupError, 'source_changed'):
                backup.capture(self.staging, self.source, self.catalog, self.now)
        self.assertFalse(any(backup.NAME.fullmatch(path.name) for path in self.staging.iterdir()))

    def test_restore_refuses_unsafe_members(self):
        blob = io.BytesIO()
        with tarfile.open(fileobj=blob, mode='w') as archive:
            archive.addfile(tarfile.TarInfo('content/../../another-directory'))
        blob.seek(0)
        with tarfile.open(fileobj=blob) as archive:
            with self.assertRaisesRegex(backup.BackupError, 'unsafe_archive_member'):
                backup.archive_inventory(archive)


if __name__ == '__main__':
    unittest.main()
