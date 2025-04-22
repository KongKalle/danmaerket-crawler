#!/bin/bash
set -e

echo "➡️ Starter hurtig installation uden Chromium-download"

# Skip download af Chromium
export PUPPETEER_SKIP_DOWNLOAD=true

npm install

echo "✅ Afhængigheder installeret"
echo "🎉 Klar til deploy"
