const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));


function checkSchemaMarkup(html) {
  const schemaRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const matches = [...html.matchAll(schemaRegex)];

  if (matches.length === 0) {
    return {
      hasSchema: false,
      schemaTypes: [],
      schemaScore: 0,
      schemaFeedback: ["❌ Ingen schema.org-markup fundet."]
    };
  }

  const types = new Set();
  let score = 0;
  const feedback = new Set();

  const scoreMap = {
    Organization: { score: 1, label: "Organization" },
    WebSite: { score: 1, label: "WebSite" },
    LocalBusiness: { score: 2, label: "LocalBusiness" },
    Product: { score: 2, label: "Product" },
    Offer: { score: 2, label: "Offer" },
    BreadcrumbList: { score: 1, label: "BreadcrumbList" }
  };

  function processEntry(entry) {
    if (!entry || typeof entry !== "object") return;

    // @graph support
    if (Array.isArray(entry["@graph"])) {
      entry["@graph"].forEach(processEntry);
    }

    const rawType = entry["@type"];
    const entryTypes = Array.isArray(rawType)
      ? rawType
      : rawType
      ? [rawType]
      : [];

    entryTypes.forEach(type => {
      if (!type) return;

      types.add(type);

      if (scoreMap[type]) {
        score += scoreMap[type].score;
        feedback.add(`✅ Har ${scoreMap[type].label}-schema`);
      }
    });
  }

  for (const match of matches) {
    try {
      const jsonStr = match[1];
      const data = JSON.parse(jsonStr);
      const entries = Array.isArray(data) ? data : [data];
      entries.forEach(processEntry);
    } catch (err) {
      console.warn("⚠️ Schema parsing-fejl:", err.message);
    }
  }

  if (types.size === 0) {
    feedback.add("❌ Ingen gyldige schema.org-typer fundet.");
  }

  return {
    hasSchema: types.size > 0,
    schemaTypes: [...types],
    schemaScore: score,
    schemaFeedback: [...feedback]
  };
}


app.post('/crawl', async (req, res) => {
  console.log('🔎 RAW body modtaget:', req.body); // <-- Sæt denne som første linje i /crawl

  const { urls } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Ingen URL-liste modtaget.' });
  }

  let browser;

  try {
    console.log('🔍 Crawler modtager URL-liste:', urls);

    browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});


    // Parallel crawling af alle URL'er
    const results = await Promise.all(urls.map(async (url) => {
      const page = await browser.newPage();
      try {
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36'
        );

        console.log('🌐 Læser:', url);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        const html = await page.content();
        await page.close();

        if (html && html.length > 0) {
          return `\n<!-- START: ${url} -->\n${html}\n<!-- END: ${url} -->\n`;
        } else {
          console.warn(`⚠️ Ingen HTML fundet på ${url}`);
          return '';
        }
      } catch (err) {
        console.warn(`⚠️ Fejl ved ${url}: ${err.message}`);
        await page.close();
        return '';
      }
    }));

    const combinedHtml = results.join('');
    const schemaInfo = checkSchemaMarkup(combinedHtml);


    if (combinedHtml.trim().length < 100) {
      console.warn('⚠️ Kombineret HTML er for begrænset.');
      return res.status(500).json({ error: 'Ingen brugbar HTML fundet.' });
    }

    return res.json({ 
  html: combinedHtml,
  hasSchema: schemaInfo.hasSchema,
  schemaTypes: schemaInfo.schemaTypes,
  schemaScore: schemaInfo.schemaScore,
  schemaFeedback: schemaInfo.schemaFeedback
});



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
