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

echo "-- an opaque origin may look, but may never write, even holding the token"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Origin: null" -H "Authorization: Bearer $TOKEN" -d '{"set":"page","to":2}' "$B/switch")" = "403"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Origin: null" -d "{\"type\":\"vary\"}" "$B/request?t=$TOKEN")" = "403"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: null" "$B/shutdown?t=$TOKEN")" = "403"

echo "-- the token in the URL is for EventSource only: it cannot mutate"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"type":"vary","params":{}}' "$B/request?t=$TOKEN")" = "401"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/shutdown?t=$TOKEN")" = "401"

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
# draining an empty queue is a normal turn, not a failure: it must exit 0 so
# a harness never paints routine polling red in the user's transcript
node "$V" drain --root "$WS" --ack 0001 --note "drew them" | grep -qx '\[\]'
# the filename carries the ask's context (slugged), so an idle-agent
# notification can name what the click was about
test -f "$WS/.variate/requests/done/0001-vary-the-hero.json"
grep -q '"result": "ok"' "$WS/.variate/requests/done/0001-vary-the-hero.json"

echo "-- an unknown request type is refused"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"type":"rm -rf"}' "$B/request")" = "400"

echo "-- an interrupted claim comes back rather than being lost"
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"type":"vary","params":{"count":4}}' "$B/request" > /dev/null
node "$V" drain --root "$WS" > /dev/null
node "$V" drain --root "$WS" | J 'j[0].redelivered' | grep -qx true

echo "-- inter is served, cacheable, and CORS-safe"
test "$(curl -s -o /dev/null -w '%{http_code}' "$B/inter.woff2")" = "200"
curl -s -D- -o /dev/null "$B/inter.woff2" | grep -qi "content-type: font/woff2"
curl -s -D- -o /dev/null -H "Origin: http://localhost:5177" "$B/inter.woff2" | grep -qi "access-control-allow-origin: http://localhost:5177"

echo "-- every switch leaves a breadcrumb saying who flipped"
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"set":"page","to":1,"source":"card"}' "$B/switch" > /dev/null
test -f "$WS/.variate/state/last-switch.json"
J 'j.set' < "$WS/.variate/state/last-switch.json" | grep -qx page
J 'j.to' < "$WS/.variate/state/last-switch.json" | grep -qx 1
J 'j.source' < "$WS/.variate/state/last-switch.json" | grep -qx card
J 'Number.isFinite(Date.parse(j.at))' < "$WS/.variate/state/last-switch.json" | grep -qx true

echo "-- keep and refine reach the queue as done and more, and drain together"
# close the claim the redelivery test left open, so the next drain is clean
OPEN=$(node "$V" drain --root "$WS" | J 'j[0].id')
set +e; node "$V" drain --root "$WS" --ack "$OPEN" > /dev/null; set -e
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"done","params":{"set":"page","n":2,"label":"two"}}' "$B/request" | J 'j.label' | grep -q 'keep 2 of page'
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"more","params":{"set":"page","from":2,"steer":"calmer","count":2}}' "$B/request" | J 'j.label' | grep -q 'calmer'

echo "-- queue state names the set, so the card can scope its pending chip"
curl -s -H "Authorization: Bearer $TOKEN" "$B/state" | J 'j.queued[0].set' | grep -qx page

OUT=$(node "$V" drain --root "$WS")
echo "$OUT" | J 'j.length' | grep -qx 2
echo "$OUT" | J 'j[0].type' | grep -qx done
echo "$OUT" | J 'j[1].type' | grep -qx more
ID1=$(echo "$OUT" | J 'j[0].id'); ID2=$(echo "$OUT" | J 'j[1].id')
set +e
node "$V" drain --root "$WS" --ack "$ID1" --note "kept it" > /dev/null
node "$V" drain --root "$WS" --ack "$ID2" --note "two tighter takes" > /dev/null
set -e
test -f "$WS/.variate/requests/done/$ID1-done-page.json"
test -f "$WS/.variate/requests/done/$ID2-more-page.json"

echo "-- a hostile set name cannot escape the queue directory"
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"vary","params":{"set":"/../../../../../../tmp/variate-pwn"}}' "$B/request" > /dev/null
test ! -e /tmp/variate-pwn.json
BAD=$(ls "$WS/.variate/requests" | grep -E '\.json$' | grep -cvE '^[0-9]{4}-(vary|more|done)(-[a-z0-9-]+)?\.json$' || true)
test "$BAD" = "0"

echo "-- unknown ask params are dropped, oversized ones capped"
LONG=$(printf 'a%.0s' $(seq 1 500))
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d "{\"type\":\"vary\",\"params\":{\"count\":4,\"evil\":\"x\",\"hint\":\"$LONG\"}}" "$B/request" \
  | J '(j.params.evil === undefined) + " " + j.params.hint.length' | grep -qx 'true 140'
OUT=$(node "$V" drain --root "$WS")
IDA=$(echo "$OUT" | J 'j[0].id'); IDB=$(echo "$OUT" | J 'j[1].id')
set +e
node "$V" drain --root "$WS" --ack "$IDA" > /dev/null
node "$V" drain --root "$WS" --ack "$IDB" > /dev/null
set -e

echo "-- a pick's selection reaches the agent, named and placed"
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"vary","params":{"count":4,"selection":{"v":2,"heading":"Getting started","place":"sidebar","tag":"div","src":"../../../../etc/passwd:1:1"}}}' "$B/request" \
  | J 'j.label' | grep -qx '4 takes of "Getting started" (sidebar)'
ls "$WS/.variate/requests" | grep -q 'vary-getting-started.json'
OUT=$(node "$V" drain --root "$WS")
echo "$OUT" | J 'j[0].params.selection.place' | grep -qx sidebar
# a src that is absolute or traverses is dropped: the agent only ever gets
# a relative, in-project path to confirm
echo "$OUT" | J 'String(j[0].params.selection.src)' | grep -qx undefined
set +e; node "$V" drain --root "$WS" --ack "$(echo "$OUT" | J 'j[0].id')" > /dev/null; set -e

echo "-- dotfiles and out-of-root symlinks are never served"
test "$(curl -s -o /dev/null -w '%{http_code}' "$B/index.html")" = "200"
test "$(curl -s -o /dev/null -w '%{http_code}' "$B/.variate/token")" = "403"
test "$(curl -s -o /dev/null -w '%{http_code}' "$B/.env")" = "403"
test "$(curl -s -o /dev/null -w '%{http_code}' "$B/.git/config")" = "403"
ln -s /etc "$WS/outside"
test "$(curl -s -o /dev/null -w '%{http_code}' "$B/outside/hosts")" = "403"
rm "$WS/outside"

echo "-- every response says nosniff"
curl -s -D- -o /dev/null "$B/health" | grep -qi 'x-content-type-options: nosniff'

echo "smoke-http PASS"
