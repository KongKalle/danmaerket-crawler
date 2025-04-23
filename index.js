const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio'); // Bruges til at parse HTML
const app = express();

app.use(cors());
app.use(express.json());

const MAX_SUBPAGES = 5;

app.post('/crawl', async (req, res) => {
  const { url } = req.body;
  console.log("📥 Modtaget URL:", url);

  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Ugyldig URL modtaget.' });
  }

  try {
    const visited = new Set();
    const toVisit = [url];
    let combinedHTML = '';

    while (toVisit.length > 0 && visited.size < MAX_SUBPAGES + 1) {
      const currentUrl = toVisit.shift();
      if (visited.has(currentUrl)) continue;

      console.log("🌐 Henter:", currentUrl);
      visited.add(currentUrl);

      try {
        const response = await axios.get(currentUrl, {
          headers: {
            'User-Agent': 'DanmaerketBot/1.0',
            'Accept': 'text/html',
          },
          timeout: 10000,
        });

        const html = response.data;
        combinedHTML += `\n\n<!-- BEGIN ${currentUrl} -->\n\n` + html;

        // Parse HTML for interne links (samme domæne)
        const $ = cheerio.load(html);
        const baseHost = new URL(url).hostname;

        $('a[href]').each((i, el) => {
          const href = $(el).attr('href');
          if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;

          let absoluteUrl;
          try {
            absoluteUrl = new URL(href, currentUrl).href;
          } catch (e) {
            return;
          }

          const linkHost = new URL(absoluteUrl).hostname;
          if (linkHost === baseHost && !visited.has(absoluteUrl) && !toVisit.includes(absoluteUrl)) {
            toVisit.push(absoluteUrl);
          }
        });

      } catch (err) {
        console.warn(`⚠️ Fejl ved ${currentUrl}:`, err.message);
      }
    }

    return res.json({ html: combinedHTML });
  } catch (error) {
    console.error('🚨 Fejl i crawl:', error.message);
    return res.status(500).json({ error: 'Crawler fejlede: ' + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Danmærket crawler kører på port ${PORT}`);
});
