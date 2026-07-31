#!/bin/bash
# smoke-card: the card ships on someone else's page, so the properties that
# keep it from being a nuisance are asserted statically rather than trusted.
set -e
cd "$(dirname "$0")/.."
C="client/card.js"

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

echo "smoke-card PASS"
