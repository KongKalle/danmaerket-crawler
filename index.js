const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
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
      const cleanUrl = currentUrl.split('#')[0]; // Fjern fragment

      if (visited.has(cleanUrl)) continue;

      console.log("🌐 Henter:", cleanUrl);
      visited.add(cleanUrl);

      try {
        const response = await axios.get(cleanUrl, {
          headers: {
            'User-Agent': 'DanmaerketBot/1.0',
            'Accept': 'text/html',
          },
          timeout: 10000,
        });

        const html = response.data;
        combinedHTML += `\n\n<!-- BEGIN ${cleanUrl} -->\n\n` + html;

        const $ = cheerio.load(html);
        const baseHost = new URL(url).hostname;

        $('a[href]').each((_, el) => {
          if (toVisit.length >= MAX_SUBPAGES) return false; // Begræns crawl-dybde

          let href = $(el).attr('href');
          if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;

          // Byg absolut URL og fjern fragment
          try {
            let absoluteUrl = new URL(href, cleanUrl).href;
            absoluteUrl = absoluteUrl.split('#')[0];

            // Spring hvis ekstern eller fil (fx .css, .js, .svg)
            const linkHost = new URL(absoluteUrl).hostname;
            const isAsset = absoluteUrl.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|ttf|eot|ico)$/i);
            if (linkHost !== baseHost || isAsset) return;

            if (!visited.has(absoluteUrl) && !toVisit.includes(absoluteUrl)) {
              toVisit.push(absoluteUrl);
            }
          } catch (e) {
            return;
          }
        });

      } catch (err) {
        console.warn(`⚠️ Fejl ved ${cleanUrl}:`, err.message);
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
