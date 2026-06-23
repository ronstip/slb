# Playwright's official image ships Chromium + all OS deps at a pinned version.
# Keep this tag in lockstep with the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev
# Install the Chromium build that matches the installed Playwright version.
# The base image ships browsers for ITS pinned Playwright; if the npm package
# resolves to a different version the bundled browser won't match (launch fails
# with "Executable doesn't exist"). Installing here keeps them in lockstep.
RUN npx playwright install chromium

COPY index.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.js"]
