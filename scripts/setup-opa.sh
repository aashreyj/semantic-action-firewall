#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT_DIR/.bin"
OPA_BIN="$BIN_DIR/opa"

mkdir -p "$BIN_DIR"

if [ ! -f "$OPA_BIN" ]; then
  curl -L -o "$OPA_BIN" "https://openpolicyagent.org/downloads/latest/opa_linux_amd64_static"
  chmod +x "$OPA_BIN"
fi

exec "$OPA_BIN" run --server "$ROOT_DIR/src/policy/policies"
