const puppeteer = require('puppeteer');

const fetcher = puppeteer.createBrowserFetcher();
const revision = '1069273'; // Stabil revision fra Puppeteer 19.11.1

fetcher.download(revision)
  .then(() => {
    console.log('✅ Chromium installeret (rev. ' + revision + ')');
  })
  .catch(err => {
    console.error('❌ Fejl ved installation af Chromium:', err.message);
    process.exit(1);
  });
