const puppeteer = require('puppeteer');

async function fetchHtml(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
      executablePath: '/usr/bin/google-chrome-stable' // Brug evt. '/usr/bin/chromium-browser' hvis den anden ikke virker
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

    // Vent lidt ekstra tid i tilfælde af langsom JS-loading
    await page.waitForTimeout(2000);

    const content = await page.content();
    return content;
  } catch (err) {
    console.log('❌ Puppeteer fejl:', err.message);
    return '';
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
