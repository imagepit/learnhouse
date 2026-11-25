"""Bind the Drive job's read-only host path to LearnHouse's actual staging PV."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

DIRECTORY = Path(__file__).resolve().parent
CLAIM = 'learnhouse-backup-staging'
NAMESPACE = 'learnhouse'


def bind(claim, volume):
    spec = volume['spec']
    claim_ref = spec['claimRef']
    if (claim['status']['phase'] != 'Bound' or volume['status']['phase'] != 'Bound'
            or spec['storageClassName'] != 'standard'
            or volume['metadata']['name'] != claim['spec']['volumeName']
            or claim_ref['name'] != CLAIM or claim_ref['namespace'] != NAMESPACE
            or claim_ref['uid'] != claim['metadata']['uid']):
        raise ValueError('staging volume does not match the LearnHouse claim')
    path = spec['hostPath']['path']
    expected = '/var/local-path-provisioner/' + volume['metadata']['name'] + '_learnhouse_' + CLAIM
    terms = spec['nodeAffinity']['required']['nodeSelectorTerms']
    if len(terms) != 1 or set(terms[0]) != {'matchExpressions'}:
        raise ValueError('staging volume does not have a single node binding')
    expressions = terms[0]['matchExpressions']
    if len(expressions) != 1:
        raise ValueError('staging volume does not have a single node binding')
    node = expressions[0]
    if (path != expected or node['key'] != 'kubernetes.io/hostname' or node['operator'] != 'In'
            or len(node['values']) != 1 or not re.fullmatch(r'[a-z0-9.-]+', node['values'][0])):
        raise ValueError('unsupported staging volume path or node')
    return path, node['values'][0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--context', default='mbp16')
    parser.add_argument('--enable', action='store_true')
    args = parser.parse_args()
    kubectl = ['kubectl', '--context', args.context]
    claim = json.loads(subprocess.check_output([*kubectl, '-n', NAMESPACE, 'get', 'pvc', CLAIM, '-o', 'json']))
    volume = json.loads(subprocess.check_output([*kubectl, 'get', 'pv', claim['spec']['volumeName'], '-o', 'json']))
    path, node = bind(claim, volume)
    rendered = subprocess.check_output(['kubectl', 'kustomize', str(DIRECTORY)], text=True)
    for token, value in (('/LEARNHOUSE_BACKUP_PV_PATH_DO_NOT_ENABLE', path),
                         ('LEARNHOUSE_BACKUP_PV_NODE', node)):
        if rendered.count(token) != 1:
            raise ValueError('expected exactly one staging placeholder')
        rendered = rendered.replace(token, value)
    if args.enable:
        if rendered.count('  suspend: true\n') != 2:
            raise ValueError('expected exactly two suspended CronJobs')
        rendered = rendered.replace('  suspend: true\n', '  suspend: false\n')
    sys.stdout.write(rendered)


if __name__ == '__main__':
    main()
