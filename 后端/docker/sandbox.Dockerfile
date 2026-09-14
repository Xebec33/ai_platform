FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g opencode-ai@1.18.30 && opencode --version

# 只读根文件系统 + tmpfs /tmp 下的默认工作目录
ENV HOME=/tmp XDG_CONFIG_HOME=/tmp/.config XDG_DATA_HOME=/tmp/.local/share XDG_CACHE_HOME=/tmp/.cache

WORKDIR /workspace
