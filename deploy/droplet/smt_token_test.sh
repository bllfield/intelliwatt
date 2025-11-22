#!/usr/bin/env bash
set -euo pipefail

SMT_API_BASE_URL="${SMT_API_BASE_URL:-https://services.smartmetertexas.net}"
SMT_USERNAME="${SMT_USERNAME:-INTELLIPATH}"

echo "SMT_API_BASE_URL: ${SMT_API_BASE_URL}"
echo "SMT_USERNAME:     ${SMT_USERNAME}"
echo

read -s -p "SMT API password: " SMT_PASSWORD
echo
echo "Requesting token from ${SMT_API_BASE_URL}/v2/token/ ..."
echo

curl -v -X POST "${SMT_API_BASE_URL}/v2/token/" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg u "$SMT_USERNAME" --arg p "$SMT_PASSWORD" '{username:$u,password:$p}')" \
  | jq .
