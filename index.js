const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 10000;

function isHtml(contentType) {
  return contentType && contentType.includes('text/html');
}

function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function normalizeUrl(base, relative) {
  try {
    return new URL(relative, base).toString().split('#')[0];
  } catch {
    return null;
  }
}

function isInternalLink(base, link) {
  try {
    const baseHost = new URL(base).host;
    const linkHost = new URL(link).host;
    return baseHost === linkHost;
  } catch {
    return false;
  }
}

function shouldInclude(link) {
  const whitelist = [
    'kontakt',
    'om',
    'handelsbetingelser',
    'betingelser',
    'vilkår',
    'cvr',
    'terms',
    'about',
    'policy',
    'privacy',
    'refund',
    'return'
  ];
  const blacklist = [
    '/products/',
    '/collections/'
  ];
  const pathname = new URL(link, 'https://dummy.dk').pathname.toLowerCase();
  return (
    whitelist.some(word => pathname.includes(word)) &&
    !blacklist.some(pattern => pathname.includes(pattern))
  );
}

const extraPolicyPaths = [
  '/policies/privacy-policy',
  '/policies/refund-policy',
  '/policies/terms-of-service',
  '/policies/shipping-policy',
  '/policies/legal-notice',
  '/policies/contact-information'
];

async function fetchHtml(url) {
  try {
    const response = await axios.get(url, { timeout: 10000 });
    if (isHtml(response.headers['content-type'])) {
      return response.data;
    }
  } catch (err) {
    console.log('❌ Crawler fejl:', err.message);
  }
  return '';
}

app.post('/crawl', async (req, res) => {
  const { url } = req.body;
  console.log('📥 Modtaget URL:', url);

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Ugyldig URL' });
  }

  const base = new URL(url).origin;
  const visited = new Set();
  const toVisit = [url, ...extraPolicyPaths.map(path => base + path)];
  let combinedHtml = '';

  while (toVisit.length > 0 && visited.size < 15) {
    const currentUrl = toVisit.shift();
    if (!currentUrl || visited.has(currentUrl)) continue;

    visited.add(currentUrl);
    console.log('🌐 Henter:', currentUrl);
    const html = await fetchHtml(currentUrl);
    combinedHtml += html;

    const $ = cheerio.load(html);
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const normalized = normalizeUrl(currentUrl, href);
      if (normalized && !visited.has(normalized) && isInternalLink(url, normalized) && shouldInclude(normalized)) {
        toVisit.push(normalized);
      }
    });
  }

  res.json({ html: combinedHtml });
});

app.listen(PORT, () => {
  console.log(`✅ Danmærket crawler kører på port ${PORT}`);
});
