FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
RUN node_modules/.bin/prisma generate
COPY . .
RUN npm run build && echo "=== DIST CONTENTS ===" && ls -la dist/ && echo "=== MAIN FILE ===" && ls dist/main* 2>/dev/null || echo "main NOT FOUND"
RUN mkdir -p uploads
ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "node_modules/.bin/prisma db push --accept-data-loss && node dist/main"]
