FROM node:22-bookworm-slim

ARG OPENCODE_VERSION=1.18.30

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && npm install --global opencode-ai@${OPENCODE_VERSION} \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

RUN useradd --create-home --uid 10001 sandbox \
  && chown -R sandbox:sandbox /workspace

USER sandbox

ENTRYPOINT ["/bin/sh"]
