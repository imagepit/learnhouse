#!/usr/bin/env bash
set -euo pipefail

image_ref="$1"
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image_ref")" = linux/amd64

suffix="$(openssl rand -hex 6)"
network="learnhouse-check-$suffix"
app="$network-app"
postgres="$network-postgres"
redis="$network-redis"
content="$network-content"
postgres_password="$(openssl rand -hex 24)"
redis_password="$(openssl rand -hex 24)"
admin_password="$(openssl rand -hex 24)"
admin_email=admin@example.com

cleanup() {
  docker rm -fv "$app" "$postgres" "$redis" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker volume rm "$content" >/dev/null 2>&1 || true
}
trap cleanup EXIT

manifest_dir="$(dirname "$0")/k8s"
postgres_image="$(awk '$1 == "image:" {print $2}' "$manifest_dir/postgres.yaml")"
redis_image="$(awk '$1 == "image:" {print $2}' "$manifest_dir/redis.yaml")"
docker network create "$network" >/dev/null
docker volume create "$content" >/dev/null
docker run --detach --name "$postgres" --network "$network" --network-alias learnhouse-postgres \
  -e POSTGRES_USER=learnhouse -e POSTGRES_DB=learnhouse -e "POSTGRES_PASSWORD=$postgres_password" \
  "$postgres_image" >/dev/null
docker run --detach --name "$redis" --network "$network" --network-alias learnhouse-redis \
  "$redis_image" redis-server --appendonly yes --requirepass "$redis_password" >/dev/null

for _ in {1..60}; do
  if docker exec "$postgres" pg_isready -h 127.0.0.1 -U learnhouse -d learnhouse >/dev/null; then
    break
  fi
  sleep 2
done
docker exec "$postgres" pg_isready -h 127.0.0.1 -U learnhouse -d learnhouse >/dev/null

public_origin="$(sed -n 's/^NEXTAUTH_URL=//p' "$manifest_dir/learnhouse.env")"
test -n "$public_origin"
forwarded_headers=(-H "Host: ${public_origin#*://}" -H "X-Forwarded-Proto: ${public_origin%%://*}")
redis_url="redis://:$redis_password@learnhouse-redis:6379/0"
docker run --detach --name "$app" --network "$network" -p 127.0.0.1::80 \
  -v "$content:/app/api/content" --env-file "$manifest_dir/learnhouse.env" \
  -e HOSTNAME=0.0.0.0 \
  -e "LEARNHOUSE_SQL_CONNECTION_STRING=postgresql://learnhouse:$postgres_password@learnhouse-postgres:5432/learnhouse" \
  -e "LEARNHOUSE_REDIS_CONNECTION_STRING=$redis_url" -e "LEARNHOUSE_REDIS_URL=$redis_url" \
  -e "LEARNHOUSE_INITIAL_ADMIN_EMAIL=$admin_email" -e "LEARNHOUSE_INITIAL_ADMIN_PASSWORD=$admin_password" \
  -e "LEARNHOUSE_AUTH_JWT_SECRET_KEY=$(openssl rand -hex 32)" \
  -e "NEXTAUTH_SECRET=$(openssl rand -hex 32)" -e "COLLAB_INTERNAL_KEY=$(openssl rand -hex 32)" \
  "$image_ref" >/dev/null

base_url="http://$(docker port "$app" 80/tcp)"
if ! health="$(curl -fsS --max-time 5 --retry 80 --retry-delay 2 --retry-all-errors "$base_url/api/v1/health")"; then
  docker logs --tail 80 "$app"
  exit 1
fi
test "$health" = true
login_page="$(curl -fsS --max-time 15 "${forwarded_headers[@]}" "$base_url/login")"
if [[ "$login_page" != *'<title>Login | IMAGEPIT PoC</title>'* ]]; then
  echo 'LearnHouse did not render the login page for the PoC organization.'
  exit 1
fi
docker exec "$postgres" psql -U learnhouse -d learnhouse -Atc \
  "SELECT EXISTS (SELECT FROM pg_extension WHERE extname = 'vector')" | grep -qx t
login_result="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code} %{content_type}' \
  "${forwarded_headers[@]}" -H "Origin: $public_origin" --data-urlencode "username=$admin_email" \
  --data-urlencode "password=$admin_password" --data-urlencode org_slug=imagepit \
  "$base_url/api/auth/login")"
[[ "$login_result" == "200 application/json"* ]] || { echo "LearnHouse login returned $login_result"; exit 1; }
