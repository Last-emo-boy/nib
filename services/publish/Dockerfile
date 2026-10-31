# nib-publish: no dependencies beyond Node itself (it runs its TypeScript directly).
FROM node:24-slim
WORKDIR /app
COPY src ./src
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/main.ts"]
