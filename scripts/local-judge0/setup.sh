#!/usr/bin/env bash
set -euo pipefail
umask 077

source_url=${1:-}
origin=${2:-https://learnhouse.image-pit.com}
if [[ ! $source_url =~ ^https://[^[:space:]]+$ && ! $source_url =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/[^[:space:]]*$ ]]; then
  echo "Usage: bash setup.sh HTTPS_ASSET_DIRECTORY [LEARNHOUSE_ORIGIN]" >&2
  exit 2
fi
if [[ ! $origin =~ ^(https://[[:alnum:].-]+(:[0-9]+)?|http://(127\.0\.0\.1|localhost):[0-9]+)$ ]]; then
  echo "Provide the LearnHouse origin without a path." >&2
  exit 2
fi
if [[ $(uname -s) != Darwin || $(uname -m) != arm64 || "$(docker info --format '{{.OperatingSystem}} {{.Architecture}}' 2>/dev/null)" != "OrbStack aarch64" ]]; then
  echo "This bundle requires Apple Silicon macOS with OrbStack selected as the Docker engine." >&2
  exit 1
fi
docker compose version >/dev/null

install_dir=${LEARNHOUSE_JUDGE0_DIR:-"$HOME/.local/share/learnhouse-local-judge0"}
mkdir -p "$install_dir"
staging=$(mktemp -d "$install_dir/download.XXXXXX")
trap 'rm -f "$staging/compose.yaml" "$staging/Dockerfile" "$staging/python-arm64.patch"; rmdir "$staging"' EXIT
for file in compose.yaml Dockerfile python-arm64.patch; do
  curl -fsSL --retry 2 --connect-timeout 10 "${source_url%/}/$file" -o "$staging/$file"
done
cd "$install_dir"
if [[ ! -f judge0.conf ]]; then
  cat > judge0.conf <<CONFIG
POSTGRES_HOST=db
REDIS_HOST=redis
POSTGRES_USER=judge0
POSTGRES_DB=judge0
POSTGRES_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
AUTHN_TOKEN=$(openssl rand -hex 24)
ALLOW_ORIGIN=$origin
ENABLE_WAIT_RESULT=false
ENABLE_ADDITIONAL_FILES=false
ALLOW_ENABLE_NETWORK=false
ENABLE_NETWORK=false
ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT=true
ALLOW_ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT=true
ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT=true
ALLOW_ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT=true
MAX_PROCESSES_AND_OR_THREADS=1
MAX_MAX_PROCESSES_AND_OR_THREADS=1
CPU_TIME_LIMIT=1
MAX_CPU_TIME_LIMIT=1
WALL_TIME_LIMIT=4
MAX_WALL_TIME_LIMIT=4
MEMORY_LIMIT=64000
MAX_MEMORY_LIMIT=64000
COUNT=1
CONFIG
elif ! grep -Fxq "ALLOW_ORIGIN=$origin" judge0.conf; then
  echo "The existing installation allows a different LearnHouse origin. Set LEARNHOUSE_JUDGE0_DIR to another directory." >&2
  exit 1
fi
for file in compose.yaml Dockerfile python-arm64.patch; do
  mv "$staging/$file" "$file"
done
docker compose up -d --build

key=$(sed -n 's/^AUTHN_TOKEN=//p' judge0.conf)
endpoint=http://127.0.0.1:2358
for ((attempt = 0; attempt < 45; attempt++)); do
  if curl -fsS --max-time 2 -H "X-Auth-Token: $key" "$endpoint/languages/71" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if ((attempt == 45)); then
  echo "Judge0 did not start at 127.0.0.1:2358. Check docker compose ps." >&2
  exit 1
fi

submission=$(curl -fsS --max-time 8 -H "X-Auth-Token: $key" -H 'Content-Type: application/json' \
  --data '{"language_id":71,"source_code":"print(42)"}' "$endpoint/submissions?wait=false")
job_id=$(printf '%s' "$submission" | plutil -extract token raw -o - -)
if [[ ! $job_id =~ ^[a-f0-9-]{36}$ ]]; then
  echo "Judge0 did not return a submission ID." >&2
  exit 1
fi
for ((attempt = 0; attempt < 20; attempt++)); do
  result=$(curl -fsS --max-time 4 -H "X-Auth-Token: $key" "$endpoint/submissions/$job_id?fields=status,stdout")
  status=$(printf '%s' "$result" | plutil -extract status.id raw -o - -)
  if [[ $status == 3 && $(printf '%s' "$result" | plutil -extract stdout raw -o - -) == 42 ]]; then
    printf 'Judge0 is ready at http://127.0.0.1:2358\nLocal run key: %s\n' "$key"
    exit 0
  fi
  if [[ $status != 1 && $status != 2 ]]; then
    break
  fi
  sleep 1
done
echo "Judge0 was reachable but the Python check did not return 42. Check docker compose ps." >&2
exit 1
