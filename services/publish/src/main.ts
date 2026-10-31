#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './server.ts';
import { Siteflow } from './siteflow.ts';
import { Sites } from './store.ts';

/** nib-publish from its environment; secrets come from files (mounted read-only). */
const env = (name: string, fallback?: string) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`${name} is required`);
  return v;
};
const secret = (name: string) => readFileSync(env(`${name}_FILE`), 'utf8').trim();

const userAgent = env('USER_AGENT', 'nib-publish/1.0');
const server = await startServer({
  gatewayKey: secret('GATEWAY_HMAC_KEY'),
  audience: env('NIB_CLIENT_ID', 'nib-desktop'),
  publicBase: env('PUBLIC_BASE', 'https://nib.w33d.xyz'),
  siteflow: new Siteflow(env('SITEFLOW_URL', 'http://siteflow-api:9360'), secret('SITEFLOW_TOKEN'), userAgent),
  sites: new Sites(join(env('DATA_DIR', '/data'), 'sites.json')),
}, Number(env('PORT', '8080')));
console.log(`nib-publish on ${JSON.stringify(server.address())}`);
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
