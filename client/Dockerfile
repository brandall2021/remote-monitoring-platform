FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Misma validacion que en la imagen combinada: que el build falle si la config no parsea.
RUN nginx -t
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
