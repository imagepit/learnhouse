"""LearnHouse database, local content and Outline image catalog backup."""
import argparse
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
import fcntl
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import traceback
import uuid
from zoneinfo import ZoneInfo

PARENT = '1YL8hRpDZP9vo7TUPmEYzIyQoiGtMNzd-'
ID = re.compile(r'[A-Za-z0-9_-]+')
NAME = re.compile(r'learnhouse-(\d{8}T\d{6}Z)-[a-f0-9]{12}')
FOLDER = 'application/vnd.google-apps.folder'
SCHEMA = 'imagepit.learnhouse.backup.v1'
ARCHIVE = 'learnhouse.tar.gz'
COMPLETE = 'COMPLETE.json'
DB = 'database.dump'
CATALOG = 'catalog.json'
MAX_ARCHIVE = 16 * 1024**3
MAX_MARKER = 4096
TOKYO = ZoneInfo('Asia/Tokyo')
ROOT = Path('/backup')
WORK = Path('/work')


class BackupError(RuntimeError):
    pass


def require(condition, reason):
    if not condition:
        raise BackupError(reason)


def emit(stage, result, **fields):
    print(json.dumps(dict(stage=stage, result=result, **fields)), flush=True)


def run(args, reason, *, env=None, capture=False):
    result = subprocess.run(
        args, env=env, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, check=False,
    )
    require(result.returncode == 0, reason)
    return result.stdout


def record(path):
    with path.open('rb') as file:
        return {'bytes': path.stat().st_size, 'sha256': hashlib.file_digest(file, 'sha256').hexdigest()}


def generation_time(name):
    match = NAME.fullmatch(name)
    require(match, 'generation_invalid')
    return datetime.strptime(match[1], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)


def marker(raw, name):
    data = json.loads(raw)
    require(set(data) == {'schema', 'generation', 'archive', 'contentFiles', 'catalogEntries'}
            and data['schema'] == SCHEMA and data['generation'] == name, 'marker_invalid')
    archive = data['archive']
    require(set(archive) == {'bytes', 'sha256'} and type(archive['bytes']) is int
            and 0 < archive['bytes'] <= MAX_ARCHIVE
            and re.fullmatch('[0-9a-f]{64}', archive['sha256'])
            and all(type(data[key]) is int and data[key] >= 0 for key in ('contentFiles', 'catalogEntries')),
            'marker_invalid')
    return data


def inventory(root):
    result = {}
    for path in root.rglob('*'):
        require(not path.is_symlink() and (path.is_dir() or path.is_file()), 'unsupported_content')
        result[str(path.relative_to(root))] = None if path.is_dir() else record(path)
    return result


def catalog_count(raw):
    data = json.loads(raw)
    require(isinstance(data, dict) and data.get('version') == 1 and isinstance(data.get('images'), list),
            'catalog_invalid')
    return len(data['images'])


def prune_staging(root, current):
    completed = sorted((p for p in root.iterdir() if NAME.fullmatch(p.name) and p.is_dir()), reverse=True)
    for old in completed[2:]:
        if old.name != current:
            shutil.rmtree(old)


def capture(root, source, catalog, now):
    name = f'learnhouse-{now:%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:12]}'
    with (root / '.capture.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for abandoned in root.glob('.capture-*'):
            if abandoned.is_dir() and not abandoned.is_symlink():
                shutil.rmtree(abandoned)
        with tempfile.TemporaryDirectory(dir=root, prefix='.capture-') as temporary:
            scratch = Path(temporary)
            output = scratch / name
            output.mkdir()
            first = inventory(source)
            catalog_raw = catalog.read_bytes()
            entries = catalog_count(catalog_raw)
            run(['pg_dump', '--format=custom', '--lock-wait-timeout=5s',
                 '--file', str(scratch / DB)], 'database_dump_failed')
            run(['pg_restore', '--list', str(scratch / DB)], 'database_dump_invalid')
            (scratch / CATALOG).write_bytes(catalog_raw)
            with tarfile.open(output / ARCHIVE, 'w:gz', compresslevel=3) as archive:
                archive.add(scratch / DB, DB)
                archive.add(scratch / CATALOG, CATALOG)
                archive.add(source, 'content')
            require(inventory(source) == first and catalog.read_bytes() == catalog_raw, 'source_changed')
            with tarfile.open(output / ARCHIVE, 'r:gz') as archive:
                require(archive_inventory(archive) == first, 'archive_content_mismatch')
            payload = record(output / ARCHIVE)
            require(0 < payload['bytes'] <= MAX_ARCHIVE, 'archive_size_invalid')
            evidence = dict(schema=SCHEMA, generation=name, archive=payload,
                            contentFiles=sum(value is not None for value in first.values()), catalogEntries=entries)
            (output / COMPLETE).write_text(json.dumps(evidence) + '\n')
            output.rename(root / name)
        prune_staging(root, name)
        emit('capture', 'verified', **evidence)


def archive_inventory(archive):
    result = {}
    roots = set()
    for member in archive:
        path = Path(member.name)
        require(not path.is_absolute() and '..' not in path.parts and (member.isdir() or member.isfile()),
                'unsafe_archive_member')
        if path.as_posix() in (DB, CATALOG, 'content'):
            require(path.as_posix() not in roots, 'duplicate_archive_member')
            roots.add(path.as_posix())
            require(member.isdir() == (path.as_posix() == 'content'), 'archive_type_invalid')
            continue
        require(path.parts[0] == 'content' and len(path.parts) > 1, 'unexpected_archive_member')
        name = str(path.relative_to('content'))
        require(name not in result, 'duplicate_archive_member')
        if member.isfile():
            with archive.extractfile(member) as data:
                result[name] = {'bytes': member.size, 'sha256': hashlib.file_digest(data, 'sha256').hexdigest()}
        else:
            result[name] = None
    require(roots == {DB, CATALOG, 'content'}, 'archive_incomplete')
    return result


def extract_archive(archive, target):
    expected = archive_inventory(archive)
    for member in archive.getmembers():
        path = target / member.name
        if member.isdir():
            path.mkdir(parents=True, exist_ok=True)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, path.open('xb') as output:
                shutil.copyfileobj(source, output)
    return expected


def select(root, now, requested):
    candidates = sorted(path.name for path in root.iterdir() if NAME.fullmatch(path.name) and path.is_dir())
    if requested:
        require(requested in candidates, 'generation_not_found')
        return requested
    require(candidates, 'capture_missing')
    name = candidates[-1]
    require(timedelta(0) <= now - generation_time(name) < timedelta(hours=6), 'capture_stale')
    return name


def scope(identifier):
    require(isinstance(identifier, str) and ID.fullmatch(identifier), 'drive_id_invalid')
    return f'drive,root_folder_id={identifier}:'


def private(entry):
    owners, grants = entry.get('owners') or [], entry.get('permissions') or []
    return (len(owners) == len(grants) == 1 and owners[0].get('me') is True
            and grants[0].get('type') == 'user' and grants[0].get('role') == 'owner'
            and grants[0].get('id') and entry.get('permissionIds') == [grants[0]['id']])


class Drive:
    def __init__(self, shared, *, read_only):
        self.shared = shared
        self.client = shared.Transport('learnhouse-restore' if read_only else 'learnhouse',
                                       deadline=time.monotonic() + 2900,
                                       binary='/work/rclone', config='/auth/rclone.conf')

    def call(self, *args):
        return self.client.call(list(args), timeout=180)

    def query(self, parent, query):
        return json.loads(self.call('backend', 'query', scope(parent), query)) or []

    def children(self, parent):
        entries = self.query(parent, f"trashed=false and '{parent}' in parents")
        require(all(row.get('parents') == [parent] and ID.fullmatch(row.get('id', ''))
                    for row in entries), 'drive_listing_invalid')
        return entries

    def folder(self, parent, name, *, create=False):
        matches = [row for row in self.children(parent) if row.get('name') == name]
        if not matches and create:
            self.call('mkdir', scope(parent) + name)
            matches = [row for row in self.children(parent) if row.get('name') == name]
        require(matches, 'drive_folder_missing')
        require(len(matches) == 1 and matches[0].get('mimeType') == FOLDER and private(matches[0]),
                'drive_folder_missing_or_shared')
        return matches[0]['id']

    def destination(self, *, create=False):
        rows = self.query(PARENT, "trashed=false and name='BACKUP' and 'me' in owners")
        matches = [row for row in rows if row.get('id') == PARENT]
        require(matches, 'drive_folder_missing')
        require(len(matches) == 1 and matches[0].get('mimeType') == FOLDER and private(matches[0]),
                'drive_parent_missing_or_shared')
        return self.folder(PARENT, 'learnhouse', create=create)

    def files(self, folder):
        rows = self.children(folder)
        files = {row['name']: row for row in rows}
        require(len(files) == len(rows) and files.keys() <= {ARCHIVE, COMPLETE}
                and all(not row['mimeType'].startswith('application/vnd.google-apps.') and private(row)
                        for row in rows), 'drive_files_unexpected')
        return files

    def download(self, folder, name, maximum, output=None):
        sink = self.shared.HashSink(output)
        self.client.stream(['cat', scope(folder), '--include', '/' + name, '--max-depth', '1'],
                           sink, maximum, timeout=900)
        return sink.record()

    def completed(self, folder, name):
        files = self.files(folder)
        require(set(files) == {ARCHIVE, COMPLETE}, 'remote_incomplete')
        raw = io.BytesIO()
        marker_record = self.download(folder, COMPLETE, MAX_MARKER, raw)
        metadata = marker(raw.getvalue(), name)
        for filename, expected in ((ARCHIVE, metadata['archive']), (COMPLETE, marker_record)):
            row = files[filename]
            require(str(expected['bytes']) == row.get('size') and expected['sha256'] == row.get('sha256Checksum'),
                    'drive_metadata_mismatch')
        return metadata, files

    def publish(self, local, name, now):
        raw = (local / COMPLETE).read_bytes()
        evidence = marker(raw, name)
        require(record(local / ARCHIVE) == evidence['archive'], 'local_archive_mismatch')
        quota = json.loads(self.call('about', scope(PARENT), '--json'))
        free = quota.get('free')
        required = evidence['archive']['bytes'] + len(raw)
        require(type(free) is int and free >= 0, 'drive_capacity_unconfirmed')
        require(free >= required, 'drive_capacity_insufficient')
        destination = self.destination(create=True)
        folder = self.folder(destination, name, create=True)
        for filename, expected in ((ARCHIVE, evidence['archive']), (COMPLETE, record(local / COMPLETE))):
            if filename not in self.files(folder):
                self.client.call(['copyto', str(local / filename), scope(folder) + filename,
                                  '--immutable'], timeout=900)
            require(filename in self.files(folder), 'drive_upload_not_listed')
            require(self.download(folder, filename, expected['bytes']) == expected, 'drive_readback_mismatch')
        require(self.completed(folder, name)[0] == evidence, 'drive_marker_mismatch')
        self.retention(destination, now, name)
        emit('drive', 'verified', folderId=folder, **evidence)

    def retention(self, destination, now, current):
        rows = self.children(destination)
        recent = (now.astimezone(TOKYO).date() - timedelta(days=13))
        completed = {}
        for row in rows:
            name = row['name']
            if not NAME.fullmatch(name) or sum(other['name'] == name for other in rows) != 1:
                continue
            if row.get('mimeType') != FOLDER or not private(row):
                continue
            if set(self.files(row['id'])) == {ARCHIVE, COMPLETE}:
                completed[name] = (row['id'], self.completed(row['id'], name)[1])
        keep = set(sorted(completed)[-2:]) | {current}
        removed = 0
        for name, (folder, files) in completed.items():
            if name in keep or generation_time(name).astimezone(TOKYO).date() >= recent:
                continue
            for filename in (COMPLETE, ARCHIVE):
                require(self.folder(destination, name) == folder and self.files(folder) == files,
                        'retention_target_changed')
                self.call('delete', scope(folder), '--include', '/' + filename,
                          '--max-depth', '1', '--max-delete', '1')
                files = {key: value for key, value in files.items() if key != filename}
            require(not self.files(folder) and self.folder(destination, name) == folder, 'retention_target_changed')
            self.call('rmdir', scope(destination) + name)
            removed += 1
        emit('retention', 'verified', kept=len(completed) - removed, trashed=removed,
             incompleteOrUnknown=len(rows) - len(completed))

    def verify_drive(self, name):
        folder = self.folder(self.destination(), name)
        metadata, _ = self.completed(folder, name)
        emit('verify-drive', 'verified', folderId=folder, **metadata)

    def restore_check(self, name, work):
        folder = self.folder(self.destination(), name)
        evidence, _ = self.completed(folder, name)
        with tempfile.TemporaryDirectory(dir=work, prefix='restore-') as temporary:
            target = Path(temporary)
            payload = target / ARCHIVE
            with payload.open('xb') as output:
                require(self.download(folder, ARCHIVE, evidence['archive']['bytes'], output)
                        == evidence['archive'], 'restore_archive_mismatch')
            restored = target / 'extracted'
            restored.mkdir()
            with tarfile.open(payload, 'r:gz') as archive:
                expected = extract_archive(archive, restored)
            require(inventory(restored / 'content') == expected
                    and sum(value is not None for value in expected.values()) == evidence['contentFiles']
                    and catalog_count((restored / CATALOG).read_bytes()) == evidence['catalogEntries'],
                    'restore_content_mismatch')
            counts = restore_database(restored / DB, target)
        emit('restore', 'verified', generation=name, contentFiles=evidence['contentFiles'],
             catalogEntries=evidence['catalogEntries'], **counts)


def restore_database(dump, target):
    cluster, socket = target / 'pgdata', target / 'socket'
    cluster.mkdir()
    socket.mkdir()
    target.chmod(0o711)
    run(['chown', 'postgres:postgres', str(cluster), str(socket)], 'restore_setup_failed')
    pg_bin = Path(run(['pg_config', '--bindir'], 'restore_setup_failed', capture=True).decode().strip())
    as_postgres = ['runuser', '-u', 'postgres', '--']
    run([*as_postgres, str(pg_bin / 'initdb'), '-D', str(cluster), '--auth=trust', '--no-locale',
         '--encoding=UTF8'], 'restore_init_failed')
    run([*as_postgres, str(pg_bin / 'pg_ctl'), '-D', str(cluster), '-l', str(cluster / 'postgres.log'),
         '-o', f"-c listen_addresses='' -c unix_socket_directories={socket}", '-w', 'start'],
        'restore_start_failed')
    try:
        connection = ['--host', str(socket), '--username', 'postgres']
        run(['createdb', *connection, 'restore_check'], 'restore_create_failed')
        run(['pg_restore', *connection, '--dbname=restore_check', '--exit-on-error',
             '--no-owner', '--no-privileges', str(dump)], 'database_restore_failed')
        values = run(['psql', *connection, '--dbname=restore_check', '-XAt', '-v', 'ON_ERROR_STOP=1',
                      '-c', 'SELECT (SELECT count(*) FROM course), (SELECT count(*) FROM activity), '
                            '(SELECT count(*) FROM "user"), (SELECT count(*) FROM assignment)'],
                     'restore_query_failed', capture=True).decode().strip().split('|')
        return dict(zip(('courses', 'activities', 'users', 'assignments'), map(int, values), strict=True))
    finally:
        run([*as_postgres, str(pg_bin / 'pg_ctl'), '-D', str(cluster), '-m', 'fast', '-w', 'stop'],
            'restore_stop_failed')


@contextmanager
def hold_capture(root):
    with (root / '.capture.lock').open('rb') as lock:
        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        yield


def load_transport():
    path = Path('/drive-common/drive_loader.py')
    if not path.is_file():
        directory = os.getenv('LEARNHOUSE_DRIVE_TRANSPORT_DIR')
        if directory:
            path = Path(directory).resolve() / 'drive_loader.py'
            require(path.is_file(), 'drive_loader_missing')
        else:
            parent = Path(__file__).resolve().parents[3]
            candidates = (
                parent / 'platform/backup',
                parent / 'imagepit/infra/backup',
                Path('/Users/imagepit/Documents/imagepit/infra/backup'),
            )
            path = next((candidate / 'drive_loader.py' for candidate in candidates
                         if (candidate / 'drive_loader.py').is_file()), None)
            require(path is not None, 'drive_transport_directory_required')

    spec = importlib.util.spec_from_file_location('_learnhouse_drive_loader', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.load(__file__)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=('capture', 'transfer', 'verify-drive', 'restore-check'))
    parser.add_argument('generation', nargs='?')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        now = datetime.now(timezone.utc)
        if args.stage == 'capture':
            capture(ROOT, Path('/content'), Path('/catalog') / CATALOG, now)
        else:
            shared = load_transport()
            drive = Drive(shared, read_only=args.stage != 'transfer')
            try:
                if args.stage == 'transfer':
                    with hold_capture(ROOT):
                        name = select(ROOT, now, args.generation)
                        drive.publish(ROOT / name, name, now)
                else:
                    require(args.generation, 'generation_required')
                    generation_time(args.generation)
                    if args.stage == 'verify-drive':
                        drive.verify_drive(args.generation)
                    else:
                        drive.restore_check(args.generation, WORK)
            except shared.TransportError as error:
                emit(args.stage, 'failed', reason=error.reason, classes=error.classes)
                return 1
    except BackupError as error:
        emit(args.stage, 'failed', reason=str(error))
        return 1
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError) as error:
        frame = traceback.extract_tb(error.__traceback__)[-1]
        emit(args.stage, 'failed', reason=type(error).__name__, function=frame.name, line=frame.lineno)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
