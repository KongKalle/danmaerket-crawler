// index.js – Danmærket crawler med loop-beskyttelse, begrænset dybde og filtrering

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

const app = express();
app.use(cors());
app.use(express.json());

const MAX_PAGES = 10;
const visited = new Set();

function isValidLink(href, baseHost) {
  if (!href) return false;
  if (href.startsWith('mailto:') || href.startsWith('tel:')) return false;
  if (href.endsWith('.css') || href.endsWith('.js') || href.endsWith('.jpg') || href.endsWith('.png') || href.endsWith('.svg')) return false;
  if (href.includes('?') || href.includes('#')) return false;
  try {
    const url = new URL(href, baseHost);
    return url.hostname === baseHost.hostname;
  } catch {
    return false;
  }
}

async function fetchAndExtract(url, baseHost) {
  if (visited.has(url) || visited.size >= MAX_PAGES) return '';

  console.log('🌐 Henter:', url);
  visited.add(url);

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'DanmaerketBot/1.0',
        'Accept': 'text/html',
      },
      timeout: 10000,
    });

    const html = response.data;
    const $ = cheerio.load(html);
    let textContent = $('body').html() || '';

    const links = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (isValidLink(href, baseHost)) {
        try {
          const fullUrl = new URL(href, baseHost).toString();
          if (!visited.has(fullUrl)) links.push(fullUrl);
        } catch {}
      }
    });

    for (const link of links.slice(0, 3)) {
      textContent += await fetchAndExtract(link, baseHost);
    }

    return textContent;
  } catch (error) {
    console.error('❌ Fejl ved hentning:', url, error.message);
    return '';
  }
}

app.post('/crawl', async (req, res) => {
  const { url } = req.body;
  console.log('📥 Modtaget URL:', url);

  if (!url) return res.status(400).json({ error: 'URL mangler.' });

  try {
    const baseHost = new URL(url);
    visited.clear();
    const resultHtml = await fetchAndExtract(url, baseHost);

    if (!resultHtml || resultHtml.length < 100) {
      return res.status(422).json({ error: 'Ingen anvendeligt HTML-indhold fundet.' });
    }

    return res.json({ html: resultHtml });
  } catch (error) {
    console.error('❌ Crawler fejl:', error.message);
    return res.status(500).json({ error: 'Crawler fejlede: ' + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Danmærket crawler kører på port ${PORT}`);
});
