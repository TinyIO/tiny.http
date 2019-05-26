FROM node:alpine

USER root

WORKDIR /tiny-net

RUN apk update && apk add python g++ make && rm -rf /var/cache/apk/*