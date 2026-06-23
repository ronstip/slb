# Playwright's official image ships Chromium + all OS deps at a pinned version.
# Keep this tag in lockstep with the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY index.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.js"]
