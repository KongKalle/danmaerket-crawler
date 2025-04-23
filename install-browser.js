const puppeteer = require('puppeteer'); // <-- brug ikke puppeteer-core her!

console.log('🔧 Install-script: Starter download af Chromium...');

puppeteer
  .createBrowserFetcher()
  .download('1069273')
  .then(() => {
    console.log('✅ Chromium installeret (rev. 1069273)');
  })
  .catch(err => {
    console.error('❌ Fejl ved installation af Chromium:', err.message);
    process.exit(1);
  });
