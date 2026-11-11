FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
EXPOSE 5173
ENV PORT=5173

# Cloud Run has no volume mounts, so when API_BASE_URL is set the container
# writes config.json itself instead of relying on the compose bind mount.
# $PORT is also injected by Cloud Run at runtime, so the app must listen on it.
CMD ["sh", "-c", "if [ -n \"$API_BASE_URL\" ]; then printf '{\"apiBaseUrl\":\"%s\",\"frontendInstance\":\"%s\"}' \"$API_BASE_URL\" \"${K_SERVICE:-docker}\" > dist/config.json; else cp public/config.json dist/config.json; fi && serve -s dist -l ${PORT:-5173}"]
