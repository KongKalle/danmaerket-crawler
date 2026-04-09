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
     // "CVR 45 68 61 08" – cifre med mellemrum (2+2+2+2 eller 4+4)
    /CVR[\s\-\.]*(nr|nummer|no)?[\s\-\.]*:?[\s]*(\d{2}[\s]\d{2}[\s]\d{2}[\s]\d{2}|\d{4}[\s]\d{4})/i,
    // "[CVR 35954716]" eller "(CVR 35954716)" – med eller uden mellemrum
    /[\[\(]\s*CVR\s+(\d{8})\s*[\]\)]/i,
    // "CVR: 12345678" eller "CVR-nr: 12345678" eller "CVR nr. 12345678"
    /CVR[\s\-\.]*(nr|nummer|no)?[\s\-\.]*:?[\s]*(\d{8})/i,
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
        // Fjern mellemrum så "45 68 61 08" bliver "45686108"
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
 *  Byg liste af undersider
 *  --------------------------- */
function buildUrlList(baseUrl) {
  const base = baseUrl.replace(/\/$/, "");

  const subpages = [
    "",
    "/handelsbetingelser",
    "/betingelser",
    "/vilkaar",
    "/vilkaar-og-betingelser",
    "/kontakt",
    "/kontakt-os",
    "/om-os",
    "/om",
    "/privatlivspolitik",
    "/persondatapolitik",
    "/cookie-politik",
  ];

  return subpages.map(path => base + path);
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

  // Byg komplet URL-liste inkl. undersider
  const allUrls = buildUrlList(urls[0]);
  console.log(`🗺️ Crawler ${allUrls.length} sider for ${urls[0]}`);

  // --- 1) Light crawl af alle sider ---
  let combinedHtml = "";
  let lightHadHardFail = false;

  for (const url of allUrls) {
    console.log("🌐 (light) Læser:", url);
    const r = await fetchHtmlLight(url);

    // Spring 404-sider over
    if (r.status === 404) {
      console.log(`⏭️ 404 – springer over: ${url}`);
      continue;
    }

    // Registrer hvis forsiden fejler
    if (url === allUrls[0] && !r.ok) lightHadHardFail = true;

    if (r.html && r.html.length) {
      combinedHtml += `\n<!-- START: ${url} -->\n${r.html}\n<!-- END: ${url} -->\n`;

      // Tidlig exit: CVR fundet – ingen grund til at crawle videre
      const cvrFound = extractCvrNumber(r.html);
      if (cvrFound) {
        console.log(`✅ CVR fundet på ${url}: ${cvrFound} – stopper tidligt`);
        break;
      }
    }
  }

  // --- 2) Puppeteer fallback hvis forside er tyndt/fejlet ---
  const needPuppeteer = isProbablyThin(combinedHtml) || lightHadHardFail;

  if (needPuppeteer) {
    try {
      console.log("🧠 Light crawl er tyndt/fejlede → prøver puppeteer på forside...");
      // Kun forsiden via puppeteer – ikke alle undersider (for ressourcekrævende)
      const pupHtml = await crawlWithPuppeteer([urls[0]]);

      if (pupHtml && pupHtml.length > combinedHtml.length) {
        combinedHtml = pupHtml;
      }
    } catch (err) {
      console.error("❌ Puppeteer fejlede:", err.message);

      if (combinedHtml && combinedHtml.trim().length > 200) {
        const schemaInfo = checkSchemaMarkup(combinedHtml);
        const cvrNummer = extractCvrNumber(combinedHtml);

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

  // --- 3) Slutresultat ---
  if (!combinedHtml || combinedHtml.trim().length < 100) {
    return res.status(500).json({ error: "Ingen brugbar HTML fundet." });
  }

  const schemaInfo = checkSchemaMarkup(combinedHtml);
  const cvrNummer = extractCvrNumber(combinedHtml);

  console.log("🔍 CVR fundet:", cvrNummer ?? "ingen");

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
