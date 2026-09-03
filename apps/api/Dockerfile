FROM node:20-alpine
WORKDIR /app
COPY packages/shared-types ./packages/shared-types
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npm install
EXPOSE 3000
CMD ["npm", "run", "dev"]
