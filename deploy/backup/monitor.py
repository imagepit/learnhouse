"""Use the common backup monitor and verify the recorded Drive generation still exists."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time
from zoneinfo import ZoneInfo

BACKUP = Path(__file__).resolve().parents[2] / 'backup'
sys.path.insert(0, str(BACKUP))
import evidence
import status

CRON = 'learnhouse-backup-drive'
JST = ZoneInfo('Asia/Tokyo')


class LocalClient(evidence.Client):
    def run(self, args):
        return evidence.bounded_run(['kubectl', '--context', 'mbp16', *args])


def job_manifest(template, generation):
    pod = template['spec']['template']['spec']
    container, = pod['containers']
    if container['name'] != 'drive' or container['args'][-1] != 'transfer':
        raise ValueError('unexpected_drive_template')
    template['metadata'].pop('ownerReferences', None)
    template['spec']['activeDeadlineSeconds'] = 300
    container['args'][-1:] = ['verify-drive', generation]
    container['volumeMounts'] = [item for item in container['volumeMounts'] if item['name'] != 'staging']
    pod['volumes'] = [item for item in pod['volumes'] if item['name'] != 'staging']
    pod['nodeSelector'] = {'kubernetes.io/arch': 'amd64'}
    return template


def read_probe(client, name, expected):
    job_resource = ['-n', 'plane', 'get', 'job', name]
    view = ['-o', 'jsonpath={.status.conditions[?(@.status=="True")].type}']
    until = time.monotonic() + 330
    while time.monotonic() < until:
        condition = client.run([*job_resource, *view]).decode().split()
        if 'Complete' in condition or 'Failed' in condition:
            break
        time.sleep(5)
    else:
        return {'result': 'unconfirmed', 'reason': 'probe_timeout'}
    logs = client.run(['-n', 'plane', 'logs', 'job/' + name, '-c', 'drive', '--limit-bytes=65536'])
    events = []
    for line in logs.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict) and event.get('stage') == 'verify-drive':
            events.append(event)
    if len(events) != 1:
        return {'result': 'unconfirmed', 'reason': 'probe_receipt_missing'}
    event = events[0]
    if 'Failed' in condition:
        reason = event.get('reason')
        if event.get('result') == 'failed' and reason in {'drive_folder_missing', 'remote_incomplete'}:
            return {'result': 'missing', 'reason': reason}
        return {'result': 'unconfirmed', 'reason': 'probe_failed'}
    if (event.get('result') != 'verified' or event.get('generation') != expected['generationId']
            or event.get('archive') != expected['artifacts']['archive']
            or not isinstance(event.get('folderId'), str) or not status.TOKEN.fullmatch(event['folderId'])):
        return {'result': 'unconfirmed', 'reason': 'probe_receipt_mismatch'}
    return {'result': 'verified', 'generationId': event['generation'], 'folderId': event['folderId'],
            'archive': event['archive']}


def check_drive(client, expected):
    generation = expected['generationId']
    match = status.LEARNHOUSE_GENERATION.fullmatch(generation)
    status.require(match, 'invalid_generation')
    name = 'learnhouse-drive-check-' + match[1].lower() + '-' + generation.rsplit('-', 1)[-1]
    existing = client.run(['-n', 'plane', 'get', 'job', name, '--ignore-not-found', '-o', 'name'])
    if not existing:
        template = json.loads(client.run(['-n', 'plane', 'create', 'job', name,
                                         '--from=cronjob/' + CRON, '--dry-run=client', '-o', 'json']))
        manifest = json.dumps(job_manifest(template, generation)).encode()
        try:
            evidence.bounded_run(['kubectl', '--context', 'mbp16', 'create', '-f', '-'], data=manifest)
        except (ValueError, OSError, subprocess.SubprocessError):
            if not client.run(['-n', 'plane', 'get', 'job', name, '--ignore-not-found', '-o', 'name']):
                raise
    return dict(read_probe(client, name, expected), job=name)


def monitor(client, probe):
    catalog = status.validate_catalog(status.load_json(BACKUP / 'catalog.json'))
    snapshot = status.collect(catalog, reader=client.run)
    evidence.attach(catalog, snapshot, client)
    evaluated = status.evaluate(catalog, snapshot)
    rows = [row for row in evaluated['targets'] if row['id'] in status.LEARNHOUSE_TARGETS]
    transfer = next(row for row in rows if row['id'] == 'LH-DRIVE')
    today = datetime.now(timezone.utc).astimezone(JST).date()
    remote = {'result': 'not_checked', 'reason': 'no_verified_transfer_today'}
    if (transfer['verification'] == 'verified' and
            status.stamp(transfer['dueAt']).astimezone(JST).date() == today):
        proof = next(p for p in snapshot['evidence'] if p['jobUid'] == transfer['job']['uid']
                     and p['targetId'] == 'LH-DRIVE')
        remote = {'result': 'not_checked', 'reason': 'receipt_only', 'generationId': proof['generationId']}
        if probe:
            try:
                remote = check_drive(client, proof)
            except (ValueError, OSError, subprocess.SubprocessError):
                remote = {'result': 'unconfirmed', 'reason': 'probe_collection_failed'}
    elif transfer['execution'] == 'succeeded' and transfer['verification'] != 'verified':
        remote = {'result': 'unconfirmed', 'reason': 'today_generation_unverified'}
    ready = all(row['verification'] == 'verified' and not row['issues'] for row in rows)
    return {'evaluatedAt': evaluated['evaluatedAt'], 'targets': rows, 'drive': remote,
            'healthy': ready and remote['result'] == 'verified'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt-only', action='store_true', help='Inspect the monitor without starting a Drive check')
    args = parser.parse_args()
    try:
        result = monitor(LocalClient(), not args.receipt_only)
    except (ValueError, OSError, subprocess.SubprocessError):
        result = {'healthy': False, 'targets': [], 'drive': {'result': 'unconfirmed',
                                                             'reason': 'monitor_collection_failed'}}
    print(json.dumps(result))
    return 0 if result['healthy'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
