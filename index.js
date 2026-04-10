const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

/** ---------------------------
 *  Schema checker
 *  --------------------------- */
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
    if (Array.isArray(entry["@graph"])) {
      entry["@graph"].forEach(processEntry);
    }
    const rawType = entry["@type"];
    const entryTypes = Array.isArray(rawType) ? rawType : rawType ? [rawType] : [];
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

  if (types.size === 0) feedback.add("❌ Ingen gyldige schema.org-typer fundet.");

  return {
    hasSchema: types.size > 0,
    schemaTypes: [...types],
    schemaScore: score,
    schemaFeedback: [...feedback]
  };
}

/** ---------------------------
 *  CVR extractor
 *  --------------------------- */
function extractCvrNumber(html) {
  if (!html) return null;

  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const patterns = [
    // "[CVR 35954716]" eller "(CVR 35954716)"
    /[\[\(]\s*CVR\s+(\d{8})\s*[\]\)]/i,
    // "CVR: 12345678" eller "CVR-nr: 12345678"
    /CVR[\s\-\.]*(nr|nummer|no)?[\s\-\.]*:?[\s]*(\d{8})/i,
    // "CVR 45 68 61 08" – cifre med mellemrum
    /CVR[\s\-\.]*(nr|nummer|no)?[\s\-\.]*:?[\s]*(\d{2}[\s]\d{2}[\s]\d{2}[\s]\d{2}|\d{4}[\s]\d{4})/i,
    // "DK18966239" eller "DK 18966239"
    /\bDK[\s]?(\d{8})\b/i,
    // "SE-nr: 12345678"
    /SE[\s\-\.]*(nr|nummer)?[\s\-\.]*:?[\s]*(\d{8})/i,
    // "Org.nr: 12345678"
    /[Oo]rg[\s\.]?nr[\s\.]*:?[\s]*(\d{8})/i,
  ];

  for (const pattern of patterns) {
    const match = plain.match(pattern);
    if (match) {
      const num = (match[2] || match[1] || "").replace(/\s/g, "");
      if (num && /^\d{8}$/.test(num)) {
        return num;
      }
    }
  }

  return null;
}

/** ---------------------------
 *  Helpers
 *  --------------------------- */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Nøgleord der indikerer relevante sider for CVR/virksomhedsinfo
const RELEVANT_KEYWORDS = [
  "om", "about", "kontakt", "contact",
  "betingelser", "vilkaar", "vilkår", "terms",
  "handelsbetingelser", "salg", "levering",
  "privatlivspolitik", "persondatapolitik", "cookie",
  "retur", "refund", "info", "cvr", "virksomhed",
  "impressum", "legal", "company"
];

function isProbablyThin(html) {
  const plain = (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length < 300;
}

async function fetchHtmlLight(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7"
      },
      redirect: "follow",
      signal: controller.signal
    });

    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, html: text || "" };
  } catch (e) {
    return { ok: false, status: 0, html: "", error: e.message };
  } finally {
    clearTimeout(timeout);
  }
}

/** ---------------------------
 *  Sitemap parser
 *  --------------------------- */
async function fetchSitemapUrls(baseUrl) {
  const base = baseUrl.replace(/\/$/, "");

  // Prøv disse sitemap-stier i rækkefølge
  const sitemapCandidates = [
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/sitemap/sitemap.xml`,
  ];

  // Tjek også robots.txt for sitemap-link
  try {
    const robotsRes = await fetchHtmlLight(`${base}/robots.txt`);
    if (robotsRes.ok && robotsRes.html) {
      const sitemapMatch = robotsRes.html.match(/Sitemap:\s*(https?:\/\/\S+)/i);
      if (sitemapMatch) {
        sitemapCandidates.unshift(sitemapMatch[1].trim());
        console.log("🤖 Sitemap fundet i robots.txt:", sitemapMatch[1].trim());
      }
    }
  } catch (e) {
    // robots.txt fejlede – ignorer
  }

  for (const sitemapUrl of sitemapCandidates) {
    try {
      const res = await fetchHtmlLight(sitemapUrl);
      if (!res.ok || !res.html) continue;

      console.log(`🗺️ Sitemap fundet: ${sitemapUrl}`);

      // Udtræk alle <loc> URL'er fra sitemap XML
      const locMatches = [...res.html.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)];
      const allUrls = locMatches
        .map(m => m[1].trim())
        .filter(u => u.startsWith("http"));

      // Håndter sitemap index (sitemap der peger på andre sitemaps)
      const isSitemapIndex = res.html.includes("<sitemapindex");
      if (isSitemapIndex && allUrls.length > 0) {
        console.log(`📑 Sitemap index fundet med ${allUrls.length} under-sitemaps`);

        // Hent første under-sitemap (typisk pages/posts)
        const subUrls = [];
        for (const subSitemapUrl of allUrls.slice(0, 3)) {
          const subRes = await fetchHtmlLight(subSitemapUrl);
          if (subRes.ok && subRes.html) {
            const subLocs = [...subRes.html.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
              .map(m => m[1].trim())
              .filter(u => u.startsWith("http"));
            subUrls.push(...subLocs);
          }
        }

        return filterRelevantUrls(subUrls, base);
      }

      return filterRelevantUrls(allUrls, base);

    } catch (e) {
      console.warn(`⚠️ Sitemap fejl for ${sitemapUrl}: ${e.message}`);
    }
  }

  console.log("📭 Ingen sitemap fundet");
  return [];
}

function filterRelevantUrls(urls, base) {
  const filtered = urls.filter(url => {
    // Kun URL'er fra samme domæne
    if (!url.startsWith(base)) return false;

    // Undgå produkt- og kategorisider (typisk mange og irrelevante)
    const lower = url.toLowerCase();
    if (/\/(products?|collections?|shop|cart|checkout|account|search|cdn|assets|media)\//i.test(lower)) {
      return false;
    }

    // Kun URL'er der indeholder relevante nøgleord
    return RELEVANT_KEYWORDS.some(kw => lower.includes(kw));
  });

  // Max 10 URL'er fra sitemap for at holde crawl-tid nede
  const result = filtered.slice(0, 10);
  console.log(`🔍 ${result.length} relevante sider fundet i sitemap`);
  return result;
}

/** ---------------------------
 *  Byg komplet URL-liste
 *  --------------------------- */
function buildFallbackUrlList(baseUrl) {
  const base = baseUrl.replace(/\/$/, "");

  const subpages = [
    "",
    "/handelsbetingelser",
    "/betingelser",
    "/vilkaar",
    "/vilkaar-og-betingelser",
    "/salgs-og-leveringsbetingelser",
    "/kontakt",
    "/kontakt-os",
    "/om-os",
    "/om",
    "/privatlivspolitik",
    "/persondatapolitik",
    "/cookie-politik",
    "/retur",
    "/returpolitik",
    // Shopify /pages/ struktur
    "/pages/handelsbetingelser",
    "/pages/betingelser",
    "/pages/vilkaar",
    "/pages/salgs-og-leveringsbetingelser",
    "/pages/kontakt",
    "/pages/om-os",
    "/pages/privatlivspolitik",
    "/pages/retur",
    "/pages/returpolitik",
  ];

  return subpages.map(path => base + path);
}

/** ---------------------------
 *  Puppeteer: singleton browser
 *  --------------------------- */
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--no-zygote",
        "--disable-gpu",
        "--single-process"
      ]
    });
  }
  return browserPromise;
}

async function safeCloseBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch (e) {
    // ignore
  } finally {
    browserPromise = null;
  }
}

async function crawlWithPuppeteer(urls) {
  const browser = await getBrowser();
  let combined = "";

  for (const url of urls) {
    const page = await browser.newPage();
    try {
      await page.setUserAgent(UA);
      await page.setRequestInterception(true);

      page.on("request", (req) => {
        const type = req.resourceType();
        if (["image", "media", "font"].includes(type)) return req.abort();
        return req.continue();
      });

      console.log("🌐 (puppeteer) Læser:", url);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

      const html = await page.content();
      if (html && html.length) {
        combined += `\n<!-- START: ${url} -->\n${html}\n<!-- END: ${url} -->\n`;
      }
    } catch (err) {
      console.warn(`⚠️ (puppeteer) Fejl ved ${url}: ${err.message}`);
    } finally {
      try { await page.close(); } catch (e) {}
    }
  }

  return combined;
}

/** ---------------------------
 *  Route: /crawl
 *  --------------------------- */
app.post("/crawl", async (req, res) => {
  console.log("🔎 RAW body modtaget:", req.body);

  const { urls } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "Ingen URL-liste modtaget." });
  }

  const baseUrl = urls[0];
  const base    = baseUrl.replace(/\/$/, "");

  // --- 1) Hent sitemap-URL'er parallelt med forside ---
  console.log(`🚀 Starter crawl af ${baseUrl}`);

  const [forsideResult, sitemapUrls] = await Promise.all([
    fetchHtmlLight(baseUrl),
    fetchSitemapUrls(baseUrl)
  ]);

  // --- 2) Byg endelig URL-liste ---
  // Prioritér: forside → sitemap-sider → fallback-liste
  const fallbackUrls = buildFallbackUrlList(baseUrl);

  // Kombiner sitemap-sider med fallback, fjern dubletter
  const allUrls = [
    baseUrl,
    ...sitemapUrls,
    ...fallbackUrls.filter(u => u !== base + "/" && u !== baseUrl)
  ].filter((url, idx, arr) => arr.indexOf(url) === idx); // unik

  console.log(`🗺️ Crawl-liste: ${allUrls.length} sider total (${sitemapUrls.length} fra sitemap)`);

  // --- 3) Crawl alle sider ---
  let combinedHtml = "";
  let lightHadHardFail = false;

  // Tilføj forside-HTML hvis vi allerede har den
  if (forsideResult.html && forsideResult.html.length) {
    combinedHtml += `\n<!-- START: ${baseUrl} -->\n${forsideResult.html}\n<!-- END: ${baseUrl} -->\n`;

    // Tjek om CVR allerede er fundet på forsiden
    const cvrOnFrontpage = extractCvrNumber(forsideResult.html);
    if (cvrOnFrontpage) {
      console.log(`✅ CVR fundet på forsiden: ${cvrOnFrontpage} – crawl af undersider springes over`);
      const schemaInfo = checkSchemaMarkup(combinedHtml);
      return res.json({
        html: combinedHtml,
        cvr_nummer: cvrOnFrontpage,
        hasSchema: schemaInfo.hasSchema,
        schemaTypes: schemaInfo.schemaTypes,
        schemaScore: schemaInfo.schemaScore,
        schemaFeedback: schemaInfo.schemaFeedback
      });
    }
  }

  if (!forsideResult.ok) lightHadHardFail = true;

  // Crawl undersider (spring forside over da vi allerede har den)
  for (const url of allUrls.slice(1)) {
    console.log("🌐 (light) Læser:", url);
    const r = await fetchHtmlLight(url);

    if (r.status === 404) {
      console.log(`⏭️ 404 – springer over: ${url}`);
      continue;
    }

    if (r.html && r.html.length) {
      combinedHtml += `\n<!-- START: ${url} -->\n${r.html}\n<!-- END: ${url} -->\n`;

      // Tidlig exit hvis CVR er fundet
      const cvrFound = extractCvrNumber(r.html);
      if (cvrFound) {
        console.log(`✅ CVR fundet på ${url}: ${cvrFound} – stopper tidligt`);
        break;
      }
    }
  }

  // --- 4) Puppeteer fallback ---
  const needPuppeteer = isProbablyThin(combinedHtml) || lightHadHardFail;

  if (needPuppeteer) {
    try {
      console.log("🧠 Light crawl er tyndt/fejlede → prøver puppeteer på forside...");
      const pupHtml = await crawlWithPuppeteer([baseUrl]);

      if (pupHtml && pupHtml.length > combinedHtml.length) {
        combinedHtml = pupHtml;
      }
    } catch (err) {
      console.error("❌ Puppeteer fejlede:", err.message);

      if (combinedHtml && combinedHtml.trim().length > 200) {
        const schemaInfo = checkSchemaMarkup(combinedHtml);
        const cvrNummer  = extractCvrNumber(combinedHtml);
        return res.json({
          html: combinedHtml,
          cvr_nummer: cvrNummer,
          hasSchema: schemaInfo.hasSchema,
          schemaTypes: schemaInfo.schemaTypes,
          schemaScore: schemaInfo.schemaScore,
          schemaFeedback: schemaInfo.schemaFeedback,
          note: "Puppeteer kunne ikke starte. Returnerer light crawl."
        });
      }

      return res.status(503).json({
        error: "Crawleren kunne ikke starte browseren. Prøv igen senere.",
        error_code: "PUPPETEER_LAUNCH_FAILED"
      });
    }
  }

  // --- 5) Slutresultat ---
  if (!combinedHtml || combinedHtml.trim().length < 100) {
    return res.status(500).json({ error: "Ingen brugbar HTML fundet." });
  }

  const schemaInfo = checkSchemaMarkup(combinedHtml);
  const cvrNummer  = extractCvrNumber(combinedHtml);

  console.log("🔍 CVR fundet:", cvrNummer ?? "ingen");
  console.log(`📊 Total HTML: ${Math.round(combinedHtml.length / 1024)}KB`);

  return res.json({
    html: combinedHtml,
    cvr_nummer: cvrNummer,
    hasSchema: schemaInfo.hasSchema,
    schemaTypes: schemaInfo.schemaTypes,
    schemaScore: schemaInfo.schemaScore,
    schemaFeedback: schemaInfo.schemaFeedback
  });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM: lukker browser...");
  await safeCloseBrowser();
  process.exit(0);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Danmærket crawler kører på port ${PORT}`));
