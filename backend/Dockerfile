FROM node:20-alpine
WORKDIR /app/backend
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
EXPOSE 4000
CMD ["npm", "start"]
