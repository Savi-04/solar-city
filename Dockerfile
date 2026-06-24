FROM node:20-bookworm-slim

# Build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Skip Playwright browser download — video capture not used in this build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
RUN npm ci

COPY . .

# Declare build-time args so Railway passes VITE_* vars during docker build
ARG VITE_GUMROAD_PRODUCT_URL
ENV VITE_GUMROAD_PRODUCT_URL=$VITE_GUMROAD_PRODUCT_URL

RUN npm run build

ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
