FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY src ./src
EXPOSE 3000
ENV PORT=3000
CMD ["npm", "start"]
