# Builds the BlueAIBridge desktop app for Linux (arm64 or x86_64, matching the
# Docker host) and packages it as .deb + .tar.gz. Used by `npm run build:linux`.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git unzip xz-utils zip file \
      clang cmake ninja-build pkg-config \
      libgtk-3-dev liblzma-dev libstdc++-12-dev libayatana-appindicator3-dev libkeybinder-3.0-dev \
      dpkg-dev \
    && rm -rf /var/lib/apt/lists/*
ARG FLUTTER_VERSION=3.50.1
RUN git clone --depth 1 --branch ${FLUTTER_VERSION} https://github.com/flutter/flutter.git /opt/flutter
ENV PATH="/opt/flutter/bin:${PATH}"
RUN git config --global --add safe.directory '*' && flutter config --no-analytics --enable-linux-desktop && flutter precache --linux
WORKDIR /src
