# Builds the BlueAIBridge desktop app for Linux (arm64 or x86_64, matching the
# Docker host) and packages it as .deb + .tar.gz. Used by `npm run build:linux`.
# Ubuntu 22.04 on purpose: the binary needs the GLib it was built against or newer,
# so building on the oldest supported release keeps the package running there.
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git unzip xz-utils zip file \
      clang cmake ninja-build pkg-config \
      libgtk-3-dev liblzma-dev libstdc++-12-dev libayatana-appindicator3-dev libkeybinder-3.0-dev \
      dpkg-dev \
    && rm -rf /var/lib/apt/lists/*
# Node.js builds the bridge (bundle-bridge.sh downloads the copy that ships in the app)
ARG NODE_VERSION=22.18.0
RUN arch=$(dpkg --print-architecture | sed 's/amd64/x64/') \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" | tar -xJ -C /usr/local --strip-components=1
ARG FLUTTER_VERSION=3.50.1
RUN git clone --depth 1 --branch ${FLUTTER_VERSION} https://github.com/flutter/flutter.git /opt/flutter
ENV PATH="/opt/flutter/bin:${PATH}"
RUN git config --global --add safe.directory '*' && flutter config --no-analytics --enable-linux-desktop && flutter precache --linux
WORKDIR /src
