FROM node:22-slim
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
ENV PORT=4177
EXPOSE 4177
CMD ["node", "server.mjs"]
