FROM oven/bun:1.4.4
WORKDIR /app
COPY . .
ENV VITE_AFC_HOSTED=1
RUN bun install --frozen-lockfile && bun run --filter @agentfico/web build
ENV NODE_ENV=production AFC_HOSTED=1 AFC_OFFLINE=1 AFC_EPHEMERAL_DB=1 HOST=0.0.0.0 PORT=10000
EXPOSE 10000
CMD ["bun", "run", "packages/cli/src/demo.ts", "--prebuilt"]
