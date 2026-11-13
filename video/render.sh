#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:18791}"
node video/record.mjs "--base-url=${BASE_URL}" --out=video/out
node video/finalize.mjs
