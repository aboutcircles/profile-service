FROM node:22

WORKDIR /app

COPY ./src ./src
COPY ./package.json ./
COPY ./package-lock.json ./
COPY ./tsconfig.json ./

RUN npm install
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]
