#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f ngrok.env ]]; then
  echo "Missing ngrok.env"
  echo "Copy ngrok.env.example to ngrok.env and set NGROK_URL"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source ngrok.env
set +a

: "${NGROK_PORT:=21826}"
if [[ -z "${NGROK_URL:-}" ]]; then
  echo "NGROK_URL is not set in ngrok.env"
  exit 1
fi

ngrok http --url="$NGROK_URL" "$NGROK_PORT"
