FROM node:22-alpine

WORKDIR /app

COPY --chown=node:node package.json ./
RUN npm install

COPY --chown=node:node . .

EXPOSE 4173

USER node

CMD ["node", "server.js"]
