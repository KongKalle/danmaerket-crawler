#!/bin/bash
set -e

echo "➡️ Starter installation af puppeteer og afhængigheder"

# Brug npm i stedet for yarn for sikkerhed
npm install

echo "✅ npm install færdig"

# Tving puppeteer til at hente Chromium (hvis nødvendigt)
npx puppeteer install

echo "✅ Puppeteer + Chromium hentet"

echo "🎉 Klar til deploy"
