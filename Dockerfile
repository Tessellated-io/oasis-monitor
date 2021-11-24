FROM node:16-buster-slim as base

FROM base

RUN apt-get update && \
    apt-get install -y libudev-dev libusb-1.0-0-dev

WORKDIR /monitor

RUN mkdir -p /monitor/src

ADD src/monitor.ts /monitor/src
ADD package.json /monitor/
ADD tsconfig.json /monitor/

RUN yarn

CMD ["yarn", "start"]
