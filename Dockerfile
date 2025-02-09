FROM node:22

WORKDIR /app

COPY . .

RUN npm install -g typescript
RUN npm install
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]
