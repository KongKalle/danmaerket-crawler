const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(cors());
app.use(express.json());

async function fetchHtml(url) {
  let browser;
  try {
    console.log('🔍 Crawler modtaget URL:', url);
    console.log('🔍 Starter Chromium fra: /usr/bin/chromium');


    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: '/usr/bin/chromium'

    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForTimeout(2000);

    return await page.content();
  } catch (err) {
    console.error('❌ Puppeteer fejl:', err.message);
    return '';
  } finally {
    if (browser) await browser.close();
  }
}

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

    for (const url of urls) {
      console.log('🌐 Besøger:', url);
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        await page.waitForTimeout(1000); // lidt luft til at load'e
        const html = await page.content();
        if (html && html.length > 0) {
          combinedHtml += '\n<!-- START: ' + url + ' -->\n' + html + '\n<!-- END: ' + url + ' -->\n';
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
    return res.status(500).json({ error: 'Intern serverfejl' });
  } finally {
    if (browser) await browser.close();
  }
});

