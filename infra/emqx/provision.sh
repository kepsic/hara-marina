#!/bin/sh
# After EMQX is up, ensure the marina ingest connector + action + rule exist.
# Idempotent: PUTs always replace existing definitions of the same name.
#
# Required in env:
#   EMQX_DASHBOARD__DEFAULT_PASSWORD
#   MARINA_INGEST_TOKEN
# Optional:
#   MARINA_INGEST_URL (default: https://hara-marina.mereveer.ee/api/ingest/telemetry)
#   EMQX_DASHBOARD__DEFAULT_USERNAME (default: admin)

set -eu

API="http://127.0.0.1:18083/api/v5"
USER="${EMQX_DASHBOARD__DEFAULT_USERNAME:-admin}"
PASS="${EMQX_DASHBOARD__DEFAULT_PASSWORD:?must be set}"
URL="${MARINA_INGEST_URL:-https://hara-marina.mereveer.ee/api/ingest/telemetry}"
TOK="${MARINA_INGEST_TOKEN:?must be set}"

# Wait until EMQX dashboard API is reachable.
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -fsS -o /dev/null "$API/status" 2>/dev/null || \
     curl -fsS -o /dev/null "http://127.0.0.1:18083/status" 2>/dev/null; then
    break
  fi
  echo "[provision] waiting for dashboard ($i/12)…"
  sleep 5
done

# Acquire JWT for dashboard API.
TOKEN=$(curl -fsS -X POST "$API/login" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" | \
  sed 's/.*"token":"\([^"]*\)".*/\1/')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "" ]; then
  echo "[provision] could not obtain dashboard token — aborting"
  exit 1
fi

AUTH="-H Authorization: Bearer $TOKEN"

# Helper: POST (create) then PUT (update on 409). Print response on error.
emqx_put() {
  url="$1"; body="$2"
  # Try POST first (create). EMQX 5 collection endpoints accept full body w/ name+type.
  http=$(curl -sS -o /tmp/resp.json -w '%{http_code}' -X POST "${url%/*}" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "$body")
  if [ "$http" = "200" ] || [ "$http" = "201" ] || [ "$http" = "204" ]; then
    return 0
  fi
  # 4xx (likely 400 already_exists or 409): fall back to PUT.
  # PUT endpoints reject `name` and `type` (they're in the URL).
  body_clean=$(printf '%s' "$body" | sed -E 's/"(name|type|id)"[[:space:]]*:[[:space:]]*"[^"]*"[[:space:]]*,?//g; s/,([[:space:]]*})/\1/g')
  http=$(curl -sS -o /tmp/resp.json -w '%{http_code}' -X PUT "$url" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "$body_clean")
  if [ "$http" = "200" ] || [ "$http" = "201" ] || [ "$http" = "204" ]; then
    return 0
  fi
  echo "[provision] FAIL $url ($http): $(cat /tmp/resp.json 2>/dev/null | head -c 500)"
  return 1
}

# Connector — pipelining=1 + small pool + explicit SNI (Vercel rejects SNI=auto)
INGEST_HOST=$(echo "$URL" | sed -E 's#^https?://([^/:]+).*#\1#')
emqx_put "$API/connectors/http:marina_ingest" "$(cat <<JSON
{
  "type": "http",
  "name": "marina_ingest",
  "url": "$URL",
  "pool_type": "random",
  "pool_size": 2,
  "connect_timeout": "15s",
  "enable_pipelining": 1,
  "ssl": {
    "enable": true,
    "verify": "verify_none",
    "server_name_indication": "$INGEST_HOST",
    "versions": ["tlsv1.3", "tlsv1.2"]
  }
}
JSON
)" && echo "[provision] connector marina_ingest ✓"

# Action
emqx_put "$API/actions/http:marina_telemetry" "$(cat <<JSON
{
  "type": "http",
  "name": "marina_telemetry",
  "connector": "marina_ingest",
  "parameters": {
    "method": "post",
    "path": "",
    "headers": {
      "content-type": "application/json",
      "authorization": "Bearer $TOK"
    },
    "body": "{\"topic\":\"\${topic}\",\"payload\":\${payload}}"
  },
  "resource_opts": {
    "worker_pool_size": 8,
    "request_ttl": "15s",
    "max_buffer_bytes": "256MB",
    "query_mode": "async"
  }
}
JSON
)" && echo "[provision] action marina_telemetry ✓"

# Rule
emqx_put "$API/rules/marina_telemetry_forward" "$(cat <<JSON
{
  "id": "marina_telemetry_forward",
  "name": "marina_telemetry_forward",
  "enable": true,
  "sql": "SELECT topic, payload FROM \"marina/+/telemetry\"",
  "actions": ["http:marina_telemetry"],
  "description": "Forward boat telemetry to Hara Marina ingest API"
}
JSON
)" && echo "[provision] rule marina_telemetry_forward ✓"

# ---------------------------------------------------------------------------
# MQTT auth: built-in DB password authenticator + built-in DB authorizer.
# Idempotent: 400 "already exists" is treated as success.
# ---------------------------------------------------------------------------

emqx_ensure() {
  # POST that tolerates "already exists" responses.
  url="$1"; body="$2"; label="$3"
  http=$(curl -sS -o /tmp/resp.json -w '%{http_code}' -X POST "$url" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "$body")
  case "$http" in
    200|201|204) echo "[provision] $label ✓"; return 0 ;;
  esac
  if grep -qiE 'already_exist|ALREADY_EXISTS|exists' /tmp/resp.json 2>/dev/null; then
    echo "[provision] $label ✓ (exists)"
    return 0
  fi
  echo "[provision] FAIL $label ($http): $(cat /tmp/resp.json 2>/dev/null | head -c 300)"
  return 1
}

emqx_ensure "$API/authentication" '{
  "mechanism": "password_based",
  "backend": "built_in_database",
  "user_id_type": "username",
  "password_hash_algorithm": {"name": "sha256", "salt_position": "suffix"}
}' "authenticator password_based:built_in_database"

emqx_ensure "$API/authorization/sources" '{
  "type": "built_in_database",
  "enable": true
}' "authorizer built_in_database"

# ---------------------------------------------------------------------------
# Per-boat MQTT users.
#
# Configured via env var MARINA_BOATS, space-separated entries of the form:
#   slug:password   (e.g. "moi:s3cret other:hunter2")
#
# For each entry we create:
#   - an MQTT user "boat-<slug>" with the given password
#   - ACL rules allowing publish on marina/<slug>/# and subscribe on
#     marina/<slug>/cmd/# (for future remote commands), default deny elsewhere
# ---------------------------------------------------------------------------

if [ -n "${MARINA_BOATS:-}" ]; then
  for entry in $MARINA_BOATS; do
    slug=$(echo "$entry" | cut -d: -f1)
    pw=$(echo "$entry"   | cut -d: -f2-)
    if [ -z "$slug" ] || [ -z "$pw" ]; then
      echo "[provision] skipping malformed boat entry: $entry"
      continue
    fi
    user="boat-$slug"

    # Create or update MQTT user (PUT updates password if user already exists)
    http=$(curl -sS -o /tmp/resp.json -w '%{http_code}' -X POST \
      "$API/authentication/password_based:built_in_database/users" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"user_id\":\"$user\",\"password\":\"$pw\"}")
    if [ "$http" != "201" ] && [ "$http" != "200" ]; then
      # User likely exists — update password via PUT
      http=$(curl -sS -o /tmp/resp.json -w '%{http_code}' -X PUT \
        "$API/authentication/password_based:built_in_database/users/$user" \
        -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
        -d "{\"password\":\"$pw\"}")
    fi
    if [ "$http" = "200" ] || [ "$http" = "201" ] || [ "$http" = "204" ]; then
      echo "[provision] mqtt user $user ✓"
    else
      echo "[provision] FAIL mqtt user $user ($http): $(cat /tmp/resp.json 2>/dev/null | head -c 200)"
    fi

    # ACL rules for this user (replace any existing set for the username)
    acl_body=$(cat <<JSON
[{
  "username": "$user",
  "rules": [
    {"topic": "marina/$slug/#",     "permission": "allow", "action": "publish"},
    {"topic": "marina/$slug/cmd/#", "permission": "allow", "action": "subscribe"},
    {"topic": "#",                  "permission": "deny",  "action": "all"}
  ]
}]
JSON
)
    http=$(curl -sS -o /tmp/resp.json -w '%{http_code}' -X POST \
      "$API/authorization/sources/built_in_database/rules/users" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "$acl_body")
    if [ "$http" = "204" ] || [ "$http" = "200" ] || [ "$http" = "201" ]; then
      echo "[provision] acl $user ✓"
    else
      echo "[provision] FAIL acl $user ($http): $(cat /tmp/resp.json 2>/dev/null | head -c 200)"
    fi
  done
else
  echo "[provision] MARINA_BOATS not set — skipping MQTT user/ACL provisioning"
fi

echo "[provision] done."
