const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

/** ---------------------------
 *  Schema checker (uændret)
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
 *  Helpers
 *  --------------------------- */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function isProbablyThin(html) {
  const plain = (html || "").replace(/<script[\s\S]*?<\/script>/gi, "")
                            .replace(/<style[\s\S]*?<\/style>/gi, "")
                            .replace(/<[^>]+>/g, " ")
                            .replace(/\s+/g, " ")
                            .trim();
  return plain.length < 300;
}

async function fetchHtmlLight(url) {
  // Node 18+ har global fetch. Hvis din runtime er ældre, så sig til.
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

    const ct = resp.headers.get("content-type") || "";
    const text = await resp.text();

    return { ok: resp.ok, status: resp.status, contentType: ct, html: text || "" };
  } catch (e) {
    return { ok: false, status: 0, contentType: "", html: "", error: e.message };
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
  // Crawl SEKVENTIELT (concurrency=1) for at undgå fork/ressource-pres
  for (const url of urls) {
    const page = await browser.newPage();
    try {
      await page.setUserAgent(UA);
      await page.setRequestInterception(true);

      page.on("request", (req) => {
        const type = req.resourceType();
        // drop tunge ting
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

  // 1) Light crawl først (billigt + virker når puppeteer fejler)
  const lightParts = [];
  let lightHadHardFail = false;

  for (const url of urls) {
    console.log("🌐 (light) Læser:", url);
    const r = await fetchHtmlLight(url);

    if (!r.ok) lightHadHardFail = true;

    if (r.html && r.html.length) {
      lightParts.push(`\n<!-- START: ${url} -->\n${r.html}\n<!-- END: ${url} -->\n`);
    } else {
      lightParts.push("");
    }
  }

  let combinedHtml = lightParts.join("");

  // 2) Hvis light er tyndt, så prøv puppeteer (hvis muligt)
  //    Hvis puppeteer fejler, returnér stadig light-resultat + et hint
  const needPuppeteer = !combinedHtml.trim() || isProbablyThin(combinedHtml) || lightHadHardFail;

  if (needPuppeteer) {
    try {
      console.log("🧠 Light crawl er tyndt/fejlede → prøver puppeteer...");
      const pupHtml = await crawlWithPuppeteer(urls);

      // Brug puppeteer-resultat hvis det giver mere
      if (pupHtml && pupHtml.length > combinedHtml.length) {
        combinedHtml = pupHtml;
      }
    } catch (err) {
      console.error("❌ Puppeteer fejlede:", err.message);

      // Hvis vi har noget light HTML, så returnér det (ikke 500)
      if (combinedHtml && combinedHtml.trim().length > 200) {
        const schemaInfo = checkSchemaMarkup(combinedHtml);
        return res.json({
          html: combinedHtml,
          hasSchema: schemaInfo.hasSchema,
          schemaTypes: schemaInfo.schemaTypes,
          schemaScore: schemaInfo.schemaScore,
          schemaFeedback: schemaInfo.schemaFeedback,
          note: "Puppeteer kunne ikke starte (ressource-limit). Returnerer light crawl."
        });
      }

      // Hvis vi intet har, så returnér en klar fejl
      return res.status(503).json({
        error: "Crawleren kunne ikke starte browseren (ressource-limit). Prøv igen senere.",
        error_code: "PUPPETEER_LAUNCH_FAILED"
      });
    }
  }

  // 3) Slutresultat
  if (!combinedHtml || combinedHtml.trim().length < 100) {
    return res.status(500).json({ error: "Ingen brugbar HTML fundet." });
  }

  const schemaInfo = checkSchemaMarkup(combinedHtml);

  return res.json({
    html: combinedHtml,
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
