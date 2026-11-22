FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=8080 DATA_FILE=/app/data/data.json
RUN mkdir -p /app/data
EXPOSE 8080
CMD ["node", "server.js"]
