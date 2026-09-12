#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
compose=(docker compose -f docker-compose.server.yml)
"${compose[@]}" config --quiet
"${compose[@]}" --profile tools run --rm --no-deps migrate node -e 'const u=new URL(process.env.DATABASE_URL);if(u.pathname!=="/davaq"||decodeURIComponent(u.username)!=="davaq")throw Error("Refusing non-DavaQ database");'
"${compose[@]}" up -d --wait redis neo4j
"${compose[@]}" --profile tools run --rm --no-deps migrate
"${compose[@]}" --profile tools run --rm --no-deps neo4j-init
"${compose[@]}" up -d --wait app web
"${compose[@]}" exec -T web wget -q -O - http://127.0.0.1/api/healthz
