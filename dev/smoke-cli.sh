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

echo "-- a static project is served with the card injected, and its files are untouched"
node "$V" up --root "$WS" --port $PORT > /dev/null
! grep -q 'variate' "$WS/index.html"
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/)" = "200"
curl -s http://127.0.0.1:$PORT/ | grep -q 'src="/v.js"'
grep -qx '.variate/' "$WS/.gitignore"
set +e; node "$V" up --root "$WS" --port $PORT > /dev/null; RC=$?; set -e
test $RC = 2
test "$(grep -c '^\.variate/$' "$WS/.gitignore")" = "1"

echo "-- add copies the file as variant 1 byte for byte"
node "$V" add "$WS/index.html" --name page --root "$WS" > /dev/null
cmp -s "$WS/index.html" "$WS/.variate/page/1.html"
test "$(cat "$WS/.variate/page/target")" = "index.html"

echo "-- a second round on the same file is refused, and points at extending"
set +e; OUT=$(node "$V" add "$WS/index.html" --name page --root "$WS"); RC=$?; set -e
test $RC = 2
echo "$OUT" | grep -q "already varies"
echo "$OUT" | grep -q "EXTEND"
# ...even under a different set name, because it is the FILE that collides
set +e; OUT=$(node "$V" add "$WS/index.html" --name something-else --root "$WS"); RC=$?; set -e
test $RC = 2
echo "$OUT" | grep -q "already varies"

echo "-- a set with one variant reports 1/1"
node "$V" status --root "$WS" --json | J 'j.sets[0].n' | grep -qx 1
node "$V" status --root "$WS" --json | J 'j.sets[0].at' | grep -qx 1

echo "-- variants land as plain files and become positions"
printf '<html><body data-variate-section="page"><h1>two</h1></body></html>\n' > "$WS/.variate/page/2.html"
printf '<html><body data-variate-section="page"><h1>three</h1></body></html>\n' > "$WS/.variate/page/3.html"
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

echo "-- check resolves a variant's imports from where the variant will LIVE"
CODE=$(mktemp -d)/app
mkdir -p "$CODE/src/components"
printf '{"name":"a","dependencies":{"react":"^19"}}\n' > "$CODE/package.json"
printf 'export function Button(){ return null }\n' > "$CODE/src/components/Button.jsx"
printf 'import { Button } from "./Button";\nexport function Hero(){ return Button }\n' > "$CODE/src/components/Hero.jsx"
node "$V" add "$CODE/src/components/Hero.jsx" --root "$CODE" > /dev/null
# a sibling import that is correct once copied over the target must NOT warn,
# even though the variant file itself sits in .variate/
printf 'import { Button } from "./Button";\nexport function Hero(){ return <div data-variate-section="hero"><Button/></div> }\n' > "$CODE/.variate/hero/2.jsx"
cat > "$CODE/.variate/hero/plan.json" <<'JSON'
{"question":"Does the hero need the product shot?",
 "positions":[{"name":"as it was"},{"name":"type only","angle":"drops the image","cost":"less to look at"}]}
JSON
node "$V" check hero --root "$CODE" | grep -q "no warnings"
node "$V" check hero --root "$CODE" | grep -q "NOT parsed"
# ...and one that would genuinely fail to build must warn
printf 'import { Nope } from "./Nope";\nimport c from "party-parrot";\nexport function Hero(){ return [Nope, c] }\n' > "$CODE/.variate/hero/3.jsx"
node "$V" check hero --root "$CODE" | grep -q 'does not resolve'
node "$V" check hero --root "$CODE" | grep -q 'not in package.json'
# a markup variant without the root marker is warned about (variant 1 never
# is: the quiet check above had an unmarked variant 1 and a marked 2)
node "$V" check hero --root "$CODE" | grep -q 'data-variate-section'
# a variant that drops the export the app imports must warn
printf 'export function Other(){ return null }\n' > "$CODE/.variate/hero/4.jsx"
node "$V" check hero --root "$CODE" | grep -q 'does not export Hero'

echo "-- only positions that actually landed can be remembered as turned down"
IMP=$(mktemp -d)/imp
mkdir -p "$IMP"; printf '<h1>one</h1>\n' > "$IMP/index.html"
node "$V" add "$IMP/index.html" --name page --root "$IMP" --n 4 > /dev/null
cat > "$IMP/.variate/page/plan.json" <<'JSON'
{"question":"How loud?","positions":[{"name":"as it was"},{"name":"the ledger"},{"name":"soft"},{"name":"weird"}]}
JSON
# the user decides on 2 before 3 and 4 are ever written: normal, the pager grows
printf '<h1>two</h1>\n' > "$IMP/.variate/page/2.html"
node "$V" use page 2 --root "$IMP" > /dev/null
node "$V" end page --root "$IMP" > /dev/null
node "$V" status --root "$IMP" --json | J 'j.passed.length' | grep -qx 0
node "$V" status --root "$IMP" | grep -q 'soft' && exit 1

echo "-- a hand edit is adopted into a FREE position, never over one that exists"
GAP=$(mktemp -d)/gap
mkdir -p "$GAP"; printf '<h1>one</h1>\n' > "$GAP/index.html"
node "$V" add "$GAP/index.html" --name page --root "$GAP" --n 3 > /dev/null
# position 3 lands before 2, which the pager explicitly supports
printf '<h1>AGENT THREE</h1>\n' > "$GAP/.variate/page/3.html"
printf '<h1>MY OWN EDIT</h1>\n' > "$GAP/index.html"
node "$V" use page 3 --root "$GAP" | grep -q "kept as 4"
grep -q 'AGENT THREE' "$GAP/.variate/page/3.html"    # the agent's work survived
grep -q 'MY OWN EDIT' "$GAP/.variate/page/4.html"    # and so did the user's
grep -q 'AGENT THREE' "$GAP/index.html"              # they got what they asked for

echo "-- check lints every position even before position 1 has landed"
NEW=$(mktemp -d)/new
mkdir -p "$NEW"
node "$V" add "$NEW/page.html" --name page --root "$NEW" --new --n 3 > /dev/null
# the dash is written as UTF-8 octal so this repo holds no literal em dash
printf '<h1>a \342\200\224 b</h1>\n' > "$NEW/.variate/page/2.html"
node "$V" check page --root "$NEW" | grep -q "em or en dash"

echo "-- the marker is stripped as an attribute, never as a selector a variant styles with"
MK=$(mktemp -d)/mk
mkdir -p "$MK"; printf '<h1>one</h1>\n' > "$MK/index.html"
node "$V" add "$MK/index.html" --name page --root "$MK" > /dev/null
cat > "$MK/.variate/page/2.html" <<'HTML'
<style>[data-variate-section="page"]{padding:4rem}</style>
<section data-variate-section="page"><h1>two</h1></section>
HTML
node "$V" use page 2 --root "$MK" > /dev/null
node "$V" end --root "$MK" > /dev/null
grep -q '\[data-variate-section="page"\]{padding:4rem}' "$MK/index.html"   # the style survived
grep -q '<section><h1>two</h1></section>' "$MK/index.html"                 # the attribute went

echo "-- an empty project is never a dead end: up scaffolds a page and serves it"
EMPTY=$(mktemp -d)/empty
mkdir -p "$EMPTY"
EPORT=$((PORT + 11))
node "$V" up --root "$EMPTY" --port $EPORT > /tmp/variate-empty.txt
grep -q "PAGE" /tmp/variate-empty.txt
grep -q "was empty" /tmp/variate-empty.txt
test -f "$EMPTY/index.html"
# the page is really served, and the card is injected rather than written in
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$EPORT/)" = "200"
curl -s http://127.0.0.1:$EPORT/ | grep -q 'src="/v.js"'
! grep -q 'v.js' "$EMPTY/index.html"

echo "-- add --new makes every position a fresh design, with no baseline"
node "$V" add index.html --new --n 4 --root "$EMPTY" | grep -q "fresh designs"
test ! -f "$EMPTY/.variate/index/1.html"     # nothing copied in
test ! -f "$EMPTY/index.html"                 # the placeholder is not a design
printf '<html><body><h1>one</h1></body></html>\n' > "$EMPTY/.variate/index/1.html"
printf '<html><body><h1>three</h1></body></html>\n' > "$EMPTY/.variate/index/3.html"
node "$V" status --root "$EMPTY" | grep -q "none on the page yet"

echo "-- the URL holds open with the card while nothing is drafted yet"
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$EPORT/)" = "200"
curl -s http://127.0.0.1:$EPORT/ | grep -q 'src="/v.js"'
# but a genuinely missing asset is still a 404, not a silent 200
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$EPORT/nope.css)" = "404"

echo "-- positions may land out of order, and the card is told which exist"
node "$V" use index 3 --root "$EMPTY" > /dev/null
grep -q '<h1>three</h1>' "$EMPTY/index.html"
curl -s "http://127.0.0.1:$EPORT/state?t=$(cat "$EMPTY/.variate/token")" | J 'j.sets[0].have.join(",")' | grep -qx "1,3"
curl -s "http://127.0.0.1:$EPORT/state?t=$(cat "$EMPTY/.variate/token")" | J 'j.sets[0].at' | grep -qx 3
# switching still leaves the card on the page, because it was never in the file
curl -s http://127.0.0.1:$EPORT/ | grep -q 'src="/v.js"'
pkill -f "sidecar.mjs --root $EMPTY" 2>/dev/null || true

echo "-- attach and eject on an indented JSX layout is byte-identical"
JSX=$(mktemp -d)/next
mkdir -p "$JSX/app"
printf '{"name":"n"}\n' > "$JSX/package.json"
printf 'export default {}\n' > "$JSX/next.config.ts"
cat > "$JSX/app/layout.tsx" <<'TSX'
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
TSX
cp "$JSX/app/layout.tsx" "$JSX/before.txt"
node "$V" up --root "$JSX" --port $((PORT + 7)) > /dev/null
grep -q 'variate:begin' "$JSX/app/layout.tsx"
# the closing tag keeps its own indentation: the block goes above it, not through it
grep -q '^      </body>$' "$JSX/app/layout.tsx"
node "$V" end --root "$JSX" > /dev/null
cmp -s "$JSX/before.txt" "$JSX/app/layout.tsx"
pkill -f "sidecar.mjs --root $JSX" 2>/dev/null || true

echo "-- add says so when nothing in the project imports the target"
printf 'export function Orphan(){ return null }\n' > "$CODE/src/components/Orphan.jsx"
node "$V" add "$CODE/src/components/Orphan.jsx" --root "$CODE" | grep -q "nothing in this project seems to import"
node "$V" add "$CODE/src/components/Button.jsx" --root "$CODE" | grep -qv "nothing in this project seems to import"

echo "-- a round is a question with costed answers, and check lints the round"
RND=$(mktemp -d)/rnd
mkdir -p "$RND"; cp fixtures/static/index.html "$RND/"
node "$V" add "$RND/index.html" --name page --root "$RND" > /dev/null
printf '<h1 data-variate-section="page">two</h1>\n' > "$RND/.variate/page/2.html"
printf '<h1 data-variate-section="page">three</h1>\n' > "$RND/.variate/page/3.html"
# the lazy round: no question, one nameless position, two positions on one idea
printf '{"positions":[{"name":"as it was"},{"name":"bolder","angle":"layout"},{"angle":"Layout"}]}\n' > "$RND/.variate/page/plan.json"
node "$V" check page --root "$RND" | grep -q "no question"
node "$V" check page --root "$RND" | grep -q "position 3 has no name"
node "$V" check page --root "$RND" | grep -q "both change"
# the real one is quiet
cat > "$RND/.variate/page/plan.json" <<'JSON'
{"question":"How much should the hero say?",
 "positions":[{"name":"as it was"},
              {"name":"the ledger","angle":"type only","cost":"nothing above the fold"},
              {"name":"split","angle":"asymmetric","cost":"weaker at 390px"}]}
JSON
node "$V" check page --root "$RND" | grep -q "no warnings"
# a plain array is still a plan, just one where a position is only a name
printf '["as it was","two","three"]\n' > "$RND/.variate/page/plan.json"
node "$V" check page --root "$RND" | grep -q "position 2 has no name" && exit 1
node "$V" status --root "$RND" --json | J 'j.sets[0].n' | grep -qx 3

echo "-- narrowing keeps the question and what the surviving position was trying"
cat > "$RND/.variate/page/plan.json" <<'JSON'
{"question":"How much should the hero say?",
 "positions":[{"name":"as it was"},
              {"name":"the ledger","angle":"type only","cost":"nothing above the fold"}]}
JSON
node "$V" use page 2 --root "$RND" > /dev/null
node "$V" narrow page --root "$RND" > /dev/null
J 'j.question' < "$RND/.variate/page/plan.json" | grep -q "How much"
J 'j.positions[0].cost' < "$RND/.variate/page/plan.json" | grep -q "above the fold"

echo "-- a settled piece is remembered, and the session recaps it at the end"
node "$V" end page --why "it reads in one breath" --root "$RND" | grep -q "the ledger"
J 'j.settled[0].kept' < "$RND/.variate/board.json" | grep -q "the ledger"
J 'j.settled[0].why' < "$RND/.variate/board.json" | grep -q "one breath"
node "$V" status --root "$RND" | grep -q "settled"
node "$V" end --root "$RND" | grep -q "SETTLED"
test ! -d "$RND/.variate"

echo "-- when the wanted port is taken, the card is told where the server ACTUALLY is"
BUSY=$((PORT + 40))
node -e "require('http').createServer((_,r)=>r.end('busy')).listen($BUSY,'127.0.0.1')" & BLOCKER=$!
sleep 1
COLL=$(mktemp -d)/coll
mkdir -p "$COLL"; cp fixtures/static/index.html "$COLL/"
node "$V" up --root "$COLL" --port $BUSY > /dev/null
REAL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$COLL/.variate/server.json','utf8')).port)")
test "$REAL" != "$BUSY"                                    # it moved off the taken port
curl -s "http://127.0.0.1:$REAL/health" | J 'j.root' | grep -qx "$COLL"
# the card must point at the port it is served from, or every call 401s
# against a stranger and the bar silently disappears
curl -s "http://127.0.0.1:$REAL/v.js" | grep -q "\"port\":$REAL"
kill $BLOCKER 2>/dev/null || true
pkill -f "sidecar.mjs --root $COLL" 2>/dev/null || true

echo "-- narrowing keeps the one they chose and drops the rest out of the pager"
NAR=$(mktemp -d)/nar
mkdir -p "$NAR"; cp fixtures/static/index.html "$NAR/"
node "$V" add "$NAR/index.html" --name page --root "$NAR" > /dev/null
printf '["as it was","the ledger","split, asymmetric","outcome first"]\n' > "$NAR/.variate/page/plan.json"
for i in 2 3 4; do printf '<h1>take %s</h1>\n' "$i" > "$NAR/.variate/page/$i.html"; done
node "$V" use page 3 --root "$NAR" > /dev/null
# with no position given it narrows to whatever is live: deciding, not counting
node "$V" narrow page --root "$NAR" | grep -q "split, asymmetric"
node "$V" status --root "$NAR" --json | J 'j.sets[0].n' | grep -qx 1
node "$V" status --root "$NAR" --json | J 'j.sets[0].at' | grep -qx 1
grep -q '<h1>take 3</h1>' "$NAR/index.html"          # the choice stayed live
test "$(cat "$NAR/.variate/page/plan.json")" != ""
# ...and nothing anyone made was destroyed
test -f "$NAR/.variate/page/.dropped/1-as-it-was.html"
test -f "$NAR/.variate/page/.dropped/4-outcome-first.html"
node "$V" status --root "$NAR" | grep -q "dropped:"
# the board remembers what was turned down (the user's own baseline is not a
# rejection), so a later round can refuse to redraw a dead direction
node "$V" status --root "$NAR" --json | J 'j.passed.length' | grep -qx 2
node "$V" status --root "$NAR" | grep -q 'passed.*outcome first'
node "$V" status --root "$NAR" | grep -q 'as it was' && exit 1
# a board is not "nothing to do", whichever way you ask for it
node "$V" status --root "$NAR" --json > /dev/null
node "$V" status --root "$NAR" > /dev/null
# a second round dropping the same position number and name must not
# overwrite what the first round put in the attic
printf '<h1>round two</h1>\n' > "$NAR/.variate/page/2.html"
printf '["where you landed","outcome first"]\n' > "$NAR/.variate/page/plan.json"
node "$V" narrow page 1 --root "$NAR" > /dev/null
test "$(ls "$NAR/.variate/page/.dropped" | wc -l | tr -d ' ')" = 4
grep -q 'outcome first' "$NAR/.variate/page/.dropped/4-outcome-first.html" && exit 1
# narrowing again when there is only one position is a no-op, not an error
set +e; node "$V" narrow page 1 --root "$NAR" > /dev/null; RC=$?; set -e
test $RC = 2
# and end still takes the whole set, attic included
node "$V" end page --root "$NAR" > /dev/null
test ! -d "$NAR/.variate/page"
grep -q '<h1>take 3</h1>' "$NAR/index.html"

echo "-- await with no card and nothing queued says: ask in chat"
NOC=$(mktemp -d)/noc
mkdir -p "$NOC"
set +e; node "$V" await --root "$NOC" > /dev/null 2>&1; RC=$?; set -e
test $RC = 3

echo "-- routine polling never looks like a failure: drain on an empty queue exits 0"
mkdir -p "$NOC/.variate/requests/done"
node "$V" drain --root "$NOC" | grep -qx '\[\]'

echo "-- await delivers an already-queued ask immediately, card or not"
mkdir -p "$NOC/.variate/requests/done"
printf '{"v":3,"id":"0001","type":"done","label":"keep 2 of page","params":{"set":"page","n":2}}\n' > "$NOC/.variate/requests/0001-done.json"
node "$V" await --root "$NOC" | J 'j.type' | grep -qx done
test -f "$NOC/.variate/requests/0001-done.json.working"

echo "-- the wake watcher stands down under a live lock, and leaves none behind"
mkdir -p "$NOC/.variate/state"
printf '{"pid":%s,"startedAt":%s,"timeoutMs":900000}' $$ "$(node -e 'console.log(Date.now())')" > "$NOC/.variate/state/wake.lock"
echo '{}' | node scripts/await.mjs --ws "$NOC/.variate" --wake --timeout 5
test -f "$NOC/.variate/state/wake.lock"        # the live holder's lock is untouched
rm "$NOC/.variate/state/wake.lock"

echo "-- and it never resurrects a workspace that end removed"
GONE=$(mktemp -d)/gone
mkdir -p "$GONE"
echo '{}' | node scripts/await.mjs --ws "$GONE/.variate" --wake --timeout 5
test ! -d "$GONE/.variate"

echo "-- end keeps what is live and removes every trace, sidecar included"
node "$V" use page 1 --root "$WS" > /dev/null
node "$V" use page 2 --root "$WS" > /dev/null
SPID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$WS/.variate/server.json','utf8')).pid)")
node "$V" end --root "$WS" > /dev/null
for i in 1 2 3 4 5; do kill -0 "$SPID" 2>/dev/null || break; sleep 0.3; done
! kill -0 "$SPID" 2>/dev/null
test ! -d "$WS/.variate"
test "$(grep -c 'variate:begin' "$WS/index.html")" = "0"
! grep -qx '.variate/' "$WS/.gitignore"
grep -q '<h1>two</h1>' "$WS/index.html"
# the working marker leaves with the session; only the design stays
! grep -q 'data-variate-section' "$WS/index.html"
# The only thing left in the diff is the design decision itself.
test "$(cd "$WS" && git status --porcelain)" = " M index.html"

echo "-- end <set> closes one round and leaves the others running"
MULTI=$(mktemp -d)/multi
mkdir -p "$MULTI"
printf '<h1>a</h1>\n' > "$MULTI/a.html"; printf '<h1>b</h1>\n' > "$MULTI/b.html"
node "$V" add "$MULTI/a.html" --root "$MULTI" > /dev/null
node "$V" add "$MULTI/b.html" --root "$MULTI" > /dev/null
printf '<h1 data-variate-section="a">a2</h1>\n' > "$MULTI/.variate/a/2.html"
node "$V" use a 2 --root "$MULTI" > /dev/null
node "$V" end a --root "$MULTI" | grep -q "variant is gone"
grep -q '<h1>a2</h1>' "$MULTI/a.html"          # the winner stayed
! grep -q 'data-variate-section' "$MULTI/a.html"   # ...without the marker
test ! -d "$MULTI/.variate/a"
test -d "$MULTI/.variate/b"                     # the other round is untouched
node "$V" status --root "$MULTI" --json | J 'j.sets.length' | grep -qx 1

echo "-- and with nothing kept, end leaves the tree exactly as it was"
WS2=$(mktemp -d)/proj2
mkdir -p "$WS2"; cp fixtures/static/index.html "$WS2/"; printf 'node_modules\n' > "$WS2/.gitignore"
(cd "$WS2" && git init -q . && git add -A && git -c user.email=t@t -c user.name=t commit -qm base)
node "$V" up --root "$WS2" --port $((PORT + 1)) > /dev/null
node "$V" add "$WS2/index.html" --name page --root "$WS2" > /dev/null
node "$V" end --root "$WS2" > /dev/null
test -z "$(cd "$WS2" && git status --porcelain)"
pkill -f "sidecar.mjs --root $WS2" 2>/dev/null || true

echo "-- a git repo with no .gitignore gets one, and end takes it back out"
GI=$(mktemp -d)/gi
mkdir -p "$GI"; cp fixtures/static/index.html "$GI/"
(cd "$GI" && git init -q . && git add -A && git -c user.email=t@t -c user.name=t commit -qm base)
node "$V" up --root "$GI" --port $((PORT + 23)) | grep -q "created .gitignore"
grep -qx '.variate/' "$GI/.gitignore"
node "$V" add "$GI/index.html" --name page --root "$GI" > /dev/null
node "$V" end --root "$GI" > /dev/null
test ! -f "$GI/.gitignore"
test -z "$(cd "$GI" && git status --porcelain)"
pkill -f "sidecar.mjs --root $GI" 2>/dev/null || true
# ...but a .gitignore the USER wrote is edited, never deleted, even when
# removing our line leaves it empty
GJ=$(mktemp -d)/gj
mkdir -p "$GJ"; cp fixtures/static/index.html "$GJ/"
printf '.variate/\n' > "$GJ/.gitignore"
(cd "$GJ" && git init -q . && git add -A && git -c user.email=t@t -c user.name=t commit -qm base)
node "$V" up --root "$GJ" --port $((PORT + 27)) > /dev/null
node "$V" add "$GJ/index.html" --name page --root "$GJ" > /dev/null
node "$V" end --root "$GJ" > /dev/null
test -f "$GJ/.gitignore"
pkill -f "sidecar.mjs --root $GJ" 2>/dev/null || true

echo "-- a filename full of regex metachars still adds cleanly"
RX=$(mktemp -d)/rx
mkdir -p "$RX"
printf '<h1>weird</h1>\n' > "$RX/Hero (v2)+final.html"
node "$V" add "$RX/Hero (v2)+final.html" --root "$RX" > /dev/null
node "$V" status --root "$RX" --json | J 'j.sets.length' | grep -qx 1

echo "-- alias imports resolve through jsconfig paths, and broken ones warn"
printf '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}\n' > "$CODE/jsconfig.json"
printf 'import { Button } from "@/components/Button";\nexport function Hero(){ return <div data-variate-section="hero"><Button/></div> }\n' > "$CODE/.variate/hero/5.jsx"
node "$V" check hero --root "$CODE" | grep -q 'does not resolve through' && exit 1
printf 'import { Nope } from "@/components/Nope";\nexport function Hero(){ return <div data-variate-section="hero">x</div> }\n' > "$CODE/.variate/hero/6.jsx"
node "$V" check hero --root "$CODE" | grep -q 'does not resolve through tsconfig paths'
# a SvelteKit-style alias is an alias, never a package.json complaint
printf 'import { t } from "$lib/i18n";\nexport function Hero(){ return t }\n' > "$CODE/.variate/hero/7.jsx"
node "$V" check hero --root "$CODE" | grep -q '"\$lib", which is not in package.json' && exit 1

echo "-- a malformed tsconfig never crashes the check"
printf '{ this is not json /* at all */ ,}\n' > "$CODE/jsconfig.json"
node "$V" check hero --root "$CODE" > /dev/null
rm "$CODE/jsconfig.json" "$CODE/.variate/hero/5.jsx" "$CODE/.variate/hero/6.jsx" "$CODE/.variate/hero/7.jsx"

echo "-- the version is single sourced, and SKILL.md agrees"
CODE_V=$(node -e "import('./src/core.mjs').then(m=>console.log(m.VERSION))")
SKILL_V=$(sed -n 's/.*version: "\([0-9.]*\)".*/\1/p' SKILL.md)
test -n "$CODE_V"
test "$CODE_V" = "$SKILL_V"

echo "smoke-cli PASS"
