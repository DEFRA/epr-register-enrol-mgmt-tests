FROM node:22.13.1-slim

ENV TZ="Europe/London"

# --no-install-recommends keeps the image to what is actually needed.
# `unzip` and `ca-certificates` are listed explicitly because they were
# previously pulled in only as Recommends (of `zip` and `curl` respectively),
# and the AWS CLI install step below needs both: TLS to fetch the zip, and
# unzip to unpack it.
RUN apt-get update -qq \
    && apt-get install -qqy --no-install-recommends \
    ca-certificates \
    curl \
    zip \
    unzip \
    openjdk-17-jre-headless

RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install

WORKDIR /app

# Copy only what the suite needs at runtime rather than the whole build
# context: `COPY . .` also baked in docker/config/*.env (local-sandbox
# credentials), compose.yml, the CI workflows and the composite action, none of
# which the container runs.
COPY package.json package-lock.json .npmrc ./

# npm ci installs the exact resolved versions from package-lock.json;
# --ignore-scripts blocks dependency lifecycle scripts. The install scripts in
# this tree are the browser-driver downloaders (edgedriver/geckodriver), unused
# because the wdio configs connect to a remote driver via CHROMEDRIVER_URL, and
# esbuild's, whose binary ships in the @esbuild/<platform> package npm ci
# installs. .npmrc already sets ignore-scripts=true, so this is the behaviour
# the image already had.
RUN npm ci --ignore-scripts

COPY bin ./bin
COPY test ./test
COPY entrypoint.sh ./
COPY wdio.conf.js wdio.local.conf.js wdio.github.conf.js ./
COPY wdio.browserstack.conf.js wdio.github.browserstack.conf.js ./

# The suite writes allure-results/, allure-report/ and FAILED into /app, so the
# non-root user needs to own it.
RUN chown -R node:node /app

USER node

ENTRYPOINT [ "./entrypoint.sh" ]

# This is downloading the linux amd64 aws cli. For M1 macs build and run with the --platform=linux/amd64 argument. eg docker build . --platform=linux/amd64
