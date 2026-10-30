#!/usr/bin/env node
import { createNodeRenderer, imagesFor } from '@nib/render/node';
import { DocumentHost } from './documents.ts';
import { serve } from './server.ts';

const renderer = await createNodeRenderer();
const host = new DocumentHost({ renderer, images: imagesFor });
await serve(host);
