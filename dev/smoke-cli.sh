#!/bin/bash
# smoke-cli: the whole set lifecycle on disk, and the promise that variate
# leaves nothing behind.
set -e
cd "$(dirname "$0")/.."
V="$PWD/variate.mjs"
WS=$(mktemp -d)/proj
mkdir -p "$WS"
cp fixtures/static/index.html "$WS/"
printf 'node_modules\n' > "$WS/.gitignore"
# Commit BEFORE variate touches anything: that is the real starting point, and
# it makes "leaves no trace" mean something.
(cd "$WS" && git init -q . && git add -A && git -c user.email=t@t -c user.name=t commit -qm base)
PORT=$((4300 + RANDOM % 500))
trap 'pkill -f "sidecar.mjs --root $WS" 2>/dev/null || true' EXIT

J() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);console.log($1)})"; }

echo "-- a project with no sets: status exits 2"
set +e; node "$V" status --root "$WS" > /dev/null; RC=$?; set -e
test $RC = 2

echo "-- up attaches the tag, ignores .variate, and is idempotent"
node "$V" up --root "$WS" --port $PORT > /dev/null
grep -q 'variate:begin' "$WS/index.html"
grep -q '127.0.0.1' "$WS/index.html"
grep -qx '.variate/' "$WS/.gitignore"
test "$(grep -c 'variate:begin' "$WS/index.html")" = "1"
set +e; node "$V" up --root "$WS" --port $PORT > /dev/null; RC=$?; set -e
test $RC = 2
test "$(grep -c 'variate:begin' "$WS/index.html")" = "1"
test "$(grep -c '^\.variate/$' "$WS/.gitignore")" = "1"

echo "-- add copies the file as variant 1 byte for byte"
node "$V" add "$WS/index.html" --name page --root "$WS" > /dev/null
cmp -s "$WS/index.html" "$WS/.variate/page/1.html"
test "$(cat "$WS/.variate/page/target")" = "index.html"

echo "-- add twice is a no-op that says so"
set +e; node "$V" add "$WS/index.html" --name page --root "$WS" > /dev/null; RC=$?; set -e
test $RC = 2

echo "-- a set with one variant reports 1/1"
node "$V" status --root "$WS" --json | J 'j.sets[0].n' | grep -qx 1
node "$V" status --root "$WS" --json | J 'j.sets[0].at' | grep -qx 1

echo "-- variants land as plain files and become positions"
printf '<html><body><h1>two</h1></body></html>\n' > "$WS/.variate/page/2.html"
printf '<html><body><h1>three</h1></body></html>\n' > "$WS/.variate/page/3.html"
node "$V" status --root "$WS" --json | J 'j.sets[0].n' | grep -qx 3

echo "-- use switches the real file, and switching back restores it exactly"
ORIG=$(mktemp); cp "$WS/.variate/page/1.html" "$ORIG"
node "$V" use page 2 --root "$WS" > /dev/null
grep -q '<h1>two</h1>' "$WS/index.html"
node "$V" status --root "$WS" --json | J 'j.sets[0].at' | grep -qx 2
node "$V" use page 1 --root "$WS" > /dev/null
cmp -s "$ORIG" "$WS/index.html"

echo "-- switching to where you already are does nothing, and says nothing changed"
BEFORE=$(stat -f %m "$WS/index.html" 2>/dev/null || stat -c %Y "$WS/index.html")
set +e; node "$V" use page 1 --root "$WS" > /dev/null; RC=$?; set -e
test $RC = 2
AFTER=$(stat -f %m "$WS/index.html" 2>/dev/null || stat -c %Y "$WS/index.html")
test "$BEFORE" = "$AFTER"

echo "-- a variant that does not exist is refused"
set +e; node "$V" use page 9 --root "$WS" 2>/dev/null; RC=$?; set -e
test $RC = 3

echo "-- a hand edit is adopted as a new variant, never destroyed"
printf '<html><body><h1>mine</h1></body></html>\n' > "$WS/index.html"
node "$V" status --root "$WS" --json | J 'String(j.sets[0].at)' | grep -qx null
node "$V" use page 2 --root "$WS" > /dev/null
grep -q '<h1>mine</h1>' "$WS/.variate/page/4.html"
node "$V" status --root "$WS" --json | J 'j.sets[0].n' | grep -qx 4

echo "-- check warns on a variant that breaks the contract, and stays quiet otherwise"
printf '<html><body><h1>bad \xe2\x80\x94 dash</h1><img src="x.png"></body></html>\n' > "$WS/.variate/page/3.html"
node "$V" check page --root "$WS" | grep -q "em or en dash"
node "$V" check page --root "$WS" | grep -q "alt text"

echo "-- end keeps what is live and removes every trace"
node "$V" use page 1 --root "$WS" > /dev/null
node "$V" use page 2 --root "$WS" > /dev/null
node "$V" end --root "$WS" > /dev/null
test ! -d "$WS/.variate"
test "$(grep -c 'variate:begin' "$WS/index.html")" = "0"
! grep -qx '.variate/' "$WS/.gitignore"
grep -q '<h1>two</h1>' "$WS/index.html"
# The only thing left in the diff is the design decision itself.
test "$(cd "$WS" && git status --porcelain)" = " M index.html"

echo "-- and with nothing kept, end leaves the tree exactly as it was"
WS2=$(mktemp -d)/proj2
mkdir -p "$WS2"; cp fixtures/static/index.html "$WS2/"; printf 'node_modules\n' > "$WS2/.gitignore"
(cd "$WS2" && git init -q . && git add -A && git -c user.email=t@t -c user.name=t commit -qm base)
node "$V" up --root "$WS2" --port $((PORT + 1)) > /dev/null
node "$V" add "$WS2/index.html" --name page --root "$WS2" > /dev/null
node "$V" end --root "$WS2" > /dev/null
test -z "$(cd "$WS2" && git status --porcelain)"
pkill -f "sidecar.mjs --root $WS2" 2>/dev/null || true

echo "smoke-cli PASS"
