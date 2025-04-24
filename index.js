const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/crawl', async (req, res) => {
  const { urls } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Ingen URL-liste modtaget.' });
  }

  let browser;
  let combinedHtml = '';

  try {
    console.log('🔍 Crawler modtager URL-liste:', urls);

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: '/usr/bin/chromium'
    });

    const page = await browser.newPage();

    // Brug en almindelig desktop user-agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36'
    );

    for (const url of urls) {
      console.log('🌐 Besøger:', url);
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForTimeout(2000);

        const html = await page.content();
        if (html && html.length > 0) {
          combinedHtml += `\n<!-- START: ${url} -->\n${html}\n<!-- END: ${url} -->\n`;
        } else {
          console.warn(`⚠️ Ingen HTML returneret for ${url}`);
        }
      } catch (innerErr) {
        console.warn(`⚠️ Fejl ved ${url}: ${innerErr.message}`);
      }
    }

    if (combinedHtml.trim().length < 100) {
      console.warn('⚠️ Kombineret HTML er for begrænset.');
      return res.status(500).json({ error: 'Ingen brugbar HTML fundet.' });
    }

    return res.json({ html: combinedHtml });

  } catch (err) {
    console.error('❌ Fejl under crawl:', err.message);
    return res.status(500).json({ error: 'Crawler fejlede: ' + err.message });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.warn('⚠️ Kunne ikke lukke browser:', closeErr.message);
      }
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Danmærket crawler kører på port ${PORT}`);
});
