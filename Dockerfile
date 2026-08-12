FROM node:20-alpine

# better-sqlite3 needs to compile a native addon
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

ENV DATA_DIR=/app/data
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/index.js"]
