#!/bin/bash
# smoke-card: the card ships on someone else's page, so the properties that
# keep it from being a nuisance are asserted statically rather than trusted.
set -e
cd "$(dirname "$0")/.."
C="client/card.js"

echo "-- it parses at all: everything below is grep, which a broken file passes"
node --check "$C"

echo "-- it can never mount twice, however many times HMR re-runs it"
grep -q 'window.__variate' "$C"
grep -q 'if (window.__variate && window.__variate.version === VARIATE.version) return' "$C"

echo "-- nothing is built from a string, so Trusted Types cannot break it"
test "$(grep -c 'innerHTML' "$C")" = "0"
test "$(grep -c 'document.write' "$C")" = "0"

echo "-- the host page's CSS cannot reach in, and ours cannot leak out"
grep -q 'attachShadow({ mode: "open" })' "$C"
grep -q 'all: initial' "$C"

echo "-- it does not print, and it does not fight a page that scrolls"
grep -q '@media print { :host { display: none } }' "$C"
grep -q 'pointer-events: none' "$C"

echo "-- keys never fire while the user is typing, or with a modifier held"
grep -q 'function typing()' "$C"
grep -q 'isContentEditable' "$C"
grep -q 'e.metaKey || e.ctrlKey || e.altKey' "$C"

echo "-- no bare letters and no Alt+Arrow: those belong to the host app"
! grep -qE '=== "[a-z]"' "$C"
! grep -q 'altKey && e.key === "Arrow' "$C"

echo "-- reduced motion is honored"
grep -q 'prefers-reduced-motion: reduce' "$C"

echo "-- the page is never styled, classed, or listened to: only measured"
! grep -qE '\.classList\.(add|remove|toggle)\(' "$C"
grep -q 'getBoundingClientRect' "$C"

echo "-- our own elements are excluded from hit testing"
grep -q 'data-variate-ignore' "$C"
grep -q 'elementsFromPoint' "$C"

echo "-- it never dead-ends: offline still flips, and tells you what to say"
grep -q 'say: variate the' "$C"

echo "-- it stays out of an iframe unless asked"
grep -q 'window.top !== window.self' "$C"

echo "-- and it can take itself off the page completely"
grep -q 'destroy()' "$C"

echo "-- it speaks inter in sentence case, never uppercase mono"
! grep -q 'text-transform' "$C"
! grep -qi 'uppercase' "$C"
! grep -q 'ui-monospace' "$C"
grep -q 'variate-inter' "$C"
grep -q 'new FontFace' "$C"
grep -q 'document.fonts.add' "$C"
grep -q -- '-apple-system' "$C"
grep -q 'tabular-nums' "$C"

echo "-- the verbs are drawn in our own namespace, and named for screen readers"
grep -q 'createElementNS' "$C"
grep -q '"aria-label": "pick a section"' "$C"
grep -q '"aria-label": "refine this one"' "$C"
grep -q '"aria-label": "keep this one"' "$C"
grep -q '"aria-hidden", "true"' "$C"

echo "-- keep and refine emit the real queue types"
grep -q 'type: "done"' "$C"
grep -q 'type: "more"' "$C"

echo "-- enter keeps, guarded, and a kept round locks and survives a reload"
grep -q '"Enter"' "$C"
grep -q 'keptFor' "$C"
grep -q 'variate.kept' "$C"

echo "-- text can be selected inside the refine input"
grep -q 'user-select: text' "$C"

echo "-- keeping offline still tells you what to say"
grep -q 'say: keep' "$C"

echo "-- tooltips are ours and instant, never the browser's one second box"
# the only title we touch is the page's own, while swapping the document in
: "$(grep -c '\.title = ' "$C")"
test "$(grep -c '\.title = ' "$C")" = "1"
grep -q 'document.title = ' "$C"
! grep -qE '\b(b|p|r|k|x)\.title = ' "$C"
grep -q 'function tip(' "$C"
grep -q 'pointerenter' "$C"

echo "-- a narrowed round of one can still be concluded, by button and by key"
grep -q 'function canDecide' "$C"
# the rule lives in exactly one place, so the button and the Enter key can
# never disagree about whether a round can be concluded
test "$(grep -c 'have.length >= 2' "$C")" = "1"
test "$(grep -c 'canDecide(' "$C")" -ge 3

echo "-- a page variate serves swaps in place rather than reloading"
grep -q 'weServeThisPage' "$C"
grep -q 'DOMParser' "$C"

echo "-- the position you are on wears its name, and the tooltip carries the cost"
grep -q 'p.name' "$C"
grep -q 'costs \${p.cost}' "$C"
grep -q 'named' "$C"

echo "-- clicking the position you are on replays it"
grep -q 'force: again' "$C"
grep -q 'click to replay' "$C"

echo "-- the bar moves off anything pinned to the bottom of the page"
grep -q 'somethingLivesUnderUs' "$C"
grep -q 'data-top' "$C"
grep -q '"fixed" || pos === "sticky"' "$C"

echo "-- a render wait never blocks the keys: only a write in flight does"
grep -q 'let switching = false' "$C"
grep -q 'if (!s || switching || keeping) return' "$C"
! grep -q 'if (!s || busy) return' "$C"
grep -q 'switching || keeping || offline' "$C"
grep -q 'renderGen' "$C"

echo "-- keep signs: the check draws once, honors reduced motion, and the tail waits"
grep -q 'data-signing' "$C"
grep -q 'signdraw' "$C"
grep -q 'let signing = false' "$C"
grep -q 'if (signing) return' "$C"
grep -q 'kBtn && !REDUCED' "$C"

echo "-- a marked variant is watched precisely, and absence is named honestly"
grep -q 'data-variate-section' "$C"
grep -q 'markerSeen' "$C"
grep -q 'not on this screen' "$C"

echo "-- a position can be linked to, but we never rewrite someone else's URL"
grep -q 'followLink' "$C"
grep -q 'searchParams.set("variate"' "$C"
grep -q 'if (!weServeThisPage()) return;' "$C"

echo "-- pick stops at a set's own marker, and sees rails the markup hides"
grep -qE 'getAttribute\("data-variate-section"\)' "$C"
grep -q '"sidebar"' "$C"
grep -q 'rail' "$C"

echo "-- pick never forces layout: no innerText anywhere"
! grep -qE '\.innerText' "$C"
grep -q 'createTreeWalker' "$C"

echo "-- the selection payload is versioned, capped, and framework-aware"
grep -q 'v: 2' "$C"
grep -q 'visibleText(node, 140)' "$C"
grep -q '__svelte_meta' "$C"
grep -q '__vueParentComponent' "$C"

echo "-- a click on a stale hover node re-resolves rather than lying"
grep -q 'pickNode.isConnected' "$C"

echo "-- the card ducks on screens that do not render the active set"
grep -q 'data-away' "$C"
grep -q 'awayTick' "$C"
grep -q 'clearInterval(awayTick)' "$C"

echo "smoke-card PASS"
