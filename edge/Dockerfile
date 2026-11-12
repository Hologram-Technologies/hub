# The edge runner as a container, for any host that runs one. It has no
# dependencies beyond Node and the prism-code runtime this repository vendors.
#
#   docker build -f edge/Dockerfile -t hub-edge .
#   docker run -p 8787:8787 hub-edge
#
# Settings (environment): PORT (8787), HOLO_URL (the kernel holo; defaults to
# the one this repository's Pages site publishes), INDEX_URL (the signed index;
# defaults to the same site's).
FROM docker.io/library/node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
WORKDIR /hub
COPY try/vendor/prism-code/src try/vendor/prism-code/src
COPY try/vendor/prism-code/package.json try/vendor/prism-code/package.json
COPY edge edge
COPY web/sigstore.mjs web/sigstore.mjs
USER node
ENV PORT=8787
EXPOSE 8787
CMD ["node", "edge/serve.mjs"]
