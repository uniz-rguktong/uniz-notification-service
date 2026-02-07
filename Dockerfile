FROM node:18-alpine
RUN apk add --no-cache openssl
WORKDIR /usr/src/app
COPY . .
RUN npm install
RUN if [ -f "prisma/schema.prisma" ]; then npx prisma generate; fi
RUN npm run build
CMD ["npm", "start"]
