FROM python:3.11-slim

# Install Node.js
RUN apt-get update && apt-get install -y curl gnupg \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y nodejs \
  && apt-get clean

#FROM node:21-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src ./src

RUN npm install --global yarn
#RUN npm install

RUN yarn install --production --frozen-lockfile
RUN yarn add --dev ts-node typescript

RUN yarn build

RUN pip install mcpo uv

CMD ["uvx", "mcpo", "--host", "0.0.0.0", "--port", "3080", "--", "uvx", "node", "build/index.js"]
