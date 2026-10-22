FROM node:22-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json server.js stats.js ./
COPY public ./public
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.js"]
