const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core'); // <- Korrekt core-udgave
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Puppeteer-funktion
async function fetchHtml(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox'],
      executablePath: '/opt/render/project/.cache/puppeteer/chrome/linux-1069273/chrome-linux/chrome'
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForTimeout(2000);

    const content = await page.content();
    return content;
  } catch (err) {
    console.error('❌ Puppeteer fejl:', err.message);
    return '';
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// API-endpoint til crawling
app.post('/crawl', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Ingen URL modtaget.' });
  }

  try {
    console.log('🔍 Crawler modtaget URL:', url);
    const html = await fetchHtml(url);

    if (!html || html.trim().length < 100) {
      console.warn('⚠️ HTML indhold for tomt eller for begrænset');
      return res.status(500).json({ error: 'HTML indhold for begrænset eller tomt.' });
    }

    return res.json({ html });
  } catch (err) {
    console.error('❌ Fejl under crawling:', err.message);
    return res.status(500).json({ error: 'Intern serverfejl' });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Danmærket crawler kører på port ${PORT}`);
});
