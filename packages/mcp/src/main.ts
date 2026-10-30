#!/usr/bin/env node
import { DocumentHost } from '@nib/daemon';
import { EXPORTERS } from '@nib/export';
import { createNodeRenderer, imagesFor } from '@nib/render/node';
import { DaemonHost, LocalHost, type McpHost } from './hosts.ts';
import { serve } from './server.ts';

// Changes go through the shared daemon, so editors show them live. NIB_HEADLESS=1 keeps documents in
// this process instead; so does a daemon that cannot start.
async function host(): Promise<McpHost> {
  if (process.env.NIB_HEADLESS !== '1') {
    try {
      return await DaemonHost.connect();
    } catch (e) {
      process.stderr.write(`nib: daemon unavailable (${(e as Error).message}); working headless\n`);
    }
  }
  return new LocalHost(new DocumentHost({ renderer: await createNodeRenderer(), images: imagesFor, exporters: EXPORTERS }));
}

// The client closed stdin: stop, even with file watches still open.
await serve(await host());
process.exit(0);
