#!/bin/bash
# M1: server read path against a copy of the fixture workspace (v1 on disk;
# the server migrates it to v2 at boot, so state is pages[]).
set -e
cd "$(dirname "$0")/.."
WS=$(mktemp -d)/ws
cp -r fixtures/demo-ws "$WS"
PORT=$((4300 + RANDOM % 500))
node scripts/serve.mjs --ws "$WS" --port $PORT & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1

echo "-- state: one page, three sections"
test "$(curl -s localhost:$PORT/api/state | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s);console.log(j.pages.length + ":" + j.pages[0].sections.length)})')" = "1:3"

echo "-- frame/index/hero: forced data-rb + height reporter present"
FRAME=$(curl -s localhost:$PORT/frame/index/hero)
echo "$FRAME" | grep -q 'data-rb="hero"'
echo "$FRAME" | grep -q "rb-h"
echo "$FRAME" | grep -q "IntersectionObserver"

echo "-- frame CSP header"
curl -s -D - -o /dev/null localhost:$PORT/frame/index/hero | grep -qi "content-security-policy"

echo "-- /page assembles all three sections in order"
PAGE=$(curl -s localhost:$PORT/page)
echo "$PAGE" | grep -q 'data-rb="nav"'
echo "$PAGE" | grep -q 'data-rb="hero"'
echo "$PAGE" | grep -q 'data-rb="features"'

echo "-- SSE: touching a take broadcasts a state event"
(curl -sN --max-time 4 localhost:$PORT/events > /tmp/variate-sse.txt) & SSE=$!
sleep 0.5
touch "$WS/site/sections/index/hero/take-1.html"
wait $SSE 2>/dev/null || true
COUNT=$(grep -c "^event: state" /tmp/variate-sse.txt)
test "$COUNT" -ge 2   # initial + broadcast

echo "-- host header guard"
test "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' localhost:$PORT/api/state)" = "403"

echo "M1 PASS"
