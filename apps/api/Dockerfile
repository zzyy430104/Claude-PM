FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --ignore-scripts && npx prisma generate
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/package.json ./
EXPOSE 3000
# 启动时先执行数据库迁移，再启动服务
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
