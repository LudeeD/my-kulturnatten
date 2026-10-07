FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
ENV NODE_ENV=production DATA_DIR=/data PORT=3030
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3030
CMD ["node", "server.js"]
