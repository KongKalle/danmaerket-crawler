# Start fra en officiel Node image
FROM node:18-slim

# Installer Chromium og afhængigheder
RUN apt-get update && \
    apt-get install -y chromium && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Opret arbejdsmappe
WORKDIR /app

# Kopier projektfiler ind
COPY . .

# Installer afhængigheder
RUN npm install

# Eksponér porten (Render bruger denne)
EXPOSE 10000

# Start appen
CMD ["node", "index.js"]
