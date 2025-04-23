const puppeteer = require('puppeteer');
puppeteer
  .createBrowserFetcher()
  .download(puppeteer._preferredRevision)
  .then(() => {
    console.log('✅ Chromium installeret');
  })
  .catch(err => {
    console.error('❌ Fejl ved installation af Chromium:', err.message);
    process.exit(1);
  });
