// index.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/crawl', async (req, res) => {
  const { url } = req.body;
  console.log("📥 Modtaget URL:", url);

  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Ugyldig URL' });
  }

  const visited = new Set();
  const toVisit = [url];
  const maxPages = 10;
  let combinedHtml = '';
  let pagesCrawled = 0;

  while (toVisit.length > 0 && pagesCrawled < maxPages) {
    const currentUrl = toVisit.shift();
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    console.log("🌐 Henter:", currentUrl);
    try {
      const response = await axios.get(currentUrl, {
        headers: { 'User-Agent': 'DanmaerketBot/1.0' },
        timeout: 10000
      });

      const html = response.data;
      combinedHtml += `\n\n<!-- ${currentUrl} -->\n\n` + html;
      pagesCrawled++;

      const $ = cheerio.load(html);
      const base = new URL(currentUrl);

      $('a').each((_, el) => {
        let href = $(el).attr('href');
        if (!href) return;

        // Fix protokol-relative links
        if (href.startsWith('//')) {
          href = 'https:' + href;
        }

        // Fjern hash og query
        href = href.split('#')[0].split('?')[0];

        // Lav til absolut URL
        let newUrl;
        try {
          newUrl = new URL(href, base.origin).href;
        } catch (e) {
          return;
        }

        // Begræns til sider og informationssider – undgå /products/ og /collections/
        if (!newUrl.startsWith(base.origin)) return;
        if (newUrl.includes('/products/') || newUrl.includes('/collections/')) return;

        if (!visited.has(newUrl) && !toVisit.includes(newUrl)) {
          toVisit.push(newUrl);
        }
      });

    } catch (err) {
      console.log('❌ Crawler fejl:', err.message);
    }
  }

  res.json({ html: combinedHtml });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Danmærket crawler kører på port ${PORT}`);
});
