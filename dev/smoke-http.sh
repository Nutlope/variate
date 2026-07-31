#!/bin/bash
# smoke-http: the sidecar's surface. Guards first, because this endpoint can
# write files in the user's project and any web page they visit can try to
# reach it.
set -e
cd "$(dirname "$0")/.."
V="$PWD/variate.mjs"
WS=$(mktemp -d)/proj
mkdir -p "$WS"
cp fixtures/static/index.html "$WS/"
PORT=$((4300 + RANDOM % 500))
trap 'pkill -f "sidecar.mjs --root $WS" 2>/dev/null || true' EXIT

J() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);console.log($1)})"; }

node "$V" up --root "$WS" --port $PORT > /dev/null
node "$V" add "$WS/index.html" --name page --root "$WS" > /dev/null
printf '<html><body><h1>two</h1></body></html>\n' > "$WS/.variate/page/2.html"
TOKEN=$(cat "$WS/.variate/token")
B="http://127.0.0.1:$PORT"

echo "-- health identifies the project, so a squatter is detectable"
curl -s "$B/health" | J 'j.ok' | grep -qx true
test "$(curl -s "$B/health" | J 'j.root')" = "$WS"

echo "-- the card is served with its address and token baked in"
curl -s "$B/v.js" | grep -q "\"port\":$PORT"
curl -s "$B/v.js" | grep -q "$TOKEN"

echo "-- state needs the token"
test "$(curl -s -o /dev/null -w '%{http_code}' "$B/state")" = "401"
curl -s -H "Authorization: Bearer $TOKEN" "$B/state" | J 'j.sets[0].n' | grep -qx 2

echo "-- a page on another origin is refused, even with a token"
test "$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: https://evil.example" -H "Authorization: Bearer $TOKEN" "$B/state")" = "403"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Origin: https://evil.example" -H "Authorization: Bearer $TOKEN" -d '{"set":"page","to":2}' "$B/switch")" = "403"

echo "-- a localhost dev server is allowed, and gets CORS back"
curl -s -D- -o /dev/null -H "Origin: http://localhost:5177" -H "Authorization: Bearer $TOKEN" "$B/state" | grep -qi "access-control-allow-origin: http://localhost:5177"

echo "-- a request with no Host of ours is refused"
test "$(curl -s -o /dev/null -w '%{http_code}' -H "Host: evil.example" "$B/health")" = "403"

echo "-- switch writes the real file"
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"set":"page","to":2}' "$B/switch" | J 'j.at' | grep -qx 2
grep -q '<h1>two</h1>' "$WS/index.html"

echo "-- a hand edit is adopted, not overwritten"
printf '<html><body><h1>mine</h1></body></html>\n' > "$WS/index.html"
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"set":"page","to":1}' "$B/switch" | J 'j.adopted' | grep -qx 3
grep -q '<h1>mine</h1>' "$WS/.variate/page/3.html"

echo "-- an unknown set or variant is refused, not guessed"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"set":"nope","to":1}' "$B/switch")" = "400"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"set":"page","to":99}' "$B/switch")" = "400"

echo "-- a set name cannot escape .variate"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"set":"../../etc","to":1}' "$B/switch")" = "400"

echo "-- events streams state"
(curl -sN --max-time 3 -H "Authorization: Bearer $TOKEN" "$B/events?t=$TOKEN" > /tmp/variate-sse-$$.txt) & SSE=$!
sleep 1
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"set":"page","to":2}' "$B/switch" > /dev/null
wait $SSE || true
test "$(grep -c '^event: state' /tmp/variate-sse-$$.txt)" -ge 2
rm -f /tmp/variate-sse-$$.txt

echo "-- the card's ask reaches the agent's queue, and comes back acked"
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"vary","params":{"count":4,"hint":"the hero"}}' "$B/request" | J 'j.id' | grep -qx 0001
OUT=$(node "$V" drain --root "$WS")
echo "$OUT" | J 'j.length' | grep -qx 1
echo "$OUT" | J 'j[0].label' | grep -q '4 takes of "the hero"'
set +e
node "$V" drain --root "$WS" --ack 0001 --note "drew them" > /dev/null; RC=$?
set -e
test $RC = 2
test -f "$WS/.variate/requests/done/0001-vary.json"
grep -q '"result": "ok"' "$WS/.variate/requests/done/0001-vary.json"

echo "-- an unknown request type is refused"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"type":"rm -rf"}' "$B/request")" = "400"

echo "-- an interrupted claim comes back rather than being lost"
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"type":"vary","params":{"count":4}}' "$B/request" > /dev/null
node "$V" drain --root "$WS" > /dev/null
node "$V" drain --root "$WS" | J 'j[0].redelivered' | grep -qx true

echo "smoke-http PASS"
