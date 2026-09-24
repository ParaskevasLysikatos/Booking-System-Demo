FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

EXPOSE 4200

CMD ["npx", "ng", "serve", "--host", "0.0.0.0", "--port", "4200", "--poll", "1000"]
