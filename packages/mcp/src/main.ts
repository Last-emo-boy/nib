#!/usr/bin/env node
import { EXPORTERS } from '@nib/export';
import { createNodeRenderer, imagesFor } from '@nib/render/node';
import { DocumentHost } from './documents.ts';
import { serve } from './server.ts';

const renderer = await createNodeRenderer();
const host = new DocumentHost({ renderer, images: imagesFor, exporters: EXPORTERS });
await serve(host);
