FROM node:24-alpine

WORKDIR /app

COPY board-api/server.mjs ./server.mjs

ENV DATA_DIR=/data
ENV PORT=8787

VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "server.mjs"]
