const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(express.json());

app.post('/crawl', async (req, res) => {
  const { url } = req.body;
  console.log("📥 Modtaget URL:", url); // Log modtaget URL

  if (!url || !url.startsWith('http')) {
    console.error('❌ Ugyldig URL modtaget:', url);
    return res.status(400).json({ error: 'Ugyldig URL modtaget.' });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'DanmaerketBot/1.0',
        'Accept': 'text/html',
      },
      timeout: 10000,
    });

    // Tjek om responsen indeholder HTML
    if (!response.data || !response.headers['content-type'].includes('text/html')) {
      return res.status(422).json({ error: 'Ingen HTML fundet på siden.' });
    }

    return res.json({ html: response.data });
  } catch (error) {
    console.error('🚨 Fejl ved crawl:', error.message);
    return res.status(500).json({ error: 'Crawler fejlede: ' + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Danmærket crawler kører på port ${PORT}`);
});
