FROM node:18-slim

# Installer nødvendige systempakker og Chromium-browser
RUN apt-get update && \
    apt-get install -y \
        chromium \
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libxss1 \
        libxcomposite1 \
        libxrandr2 \
        libasound2 \
        libxdamage1 \
        libgbm1 \
        libgtk-3-0 \
        libdrm2 \
        --no-install-recommends && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Miljøvariabel (kan bruges til debugging/log)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app
COPY . .

RUN npm install

EXPOSE 10000

CMD ["node", "index.js"]
