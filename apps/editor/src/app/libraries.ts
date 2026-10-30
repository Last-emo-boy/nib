import { useEffect, useState } from 'react';
import type { PenDoc } from '@nib/core';
import type { Node } from '@nib/format';
import { authHeaders, token } from './connection.ts';

/** A design system nib ships, as /api/libraries describes it. */
export interface LibraryInfo {
  id: string;
  name: string;
  summary: { en: string; zh: string };
  basedOn: string;
  license: string;
  homepage: string;
  components: number;
  themes: Record<string, string[]>;
  /** Present when the library can be made in a brand's colors. */
  brand?: { anchor: string };
}

let catalog: Promise<LibraryInfo[]> | undefined;

export function useLibraries(): LibraryInfo[] {
  const [libs, setLibs] = useState<LibraryInfo[]>([]);
  useEffect(() => {
    catalog ??= fetch('/api/libraries', { headers: authHeaders() }).then((r) => r.json()).then((j) => (j.libraries ?? []) as LibraryInfo[], () => []);
    let live = true;
    void catalog.then((l) => live && setLibs(l));
    return () => { live = false; };
  }, []);
  return libs;
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as T;
}

/** A reusable component of a document, `id` qualified by the alias it is imported under. */
export interface ComponentEntry { id: string; name: string; group: string; label: string }

/** A document's components, grouped by their name: "Button / Outline" is Outline in group Button. */
export function componentsOf(doc: PenDoc, prefix = ''): ComponentEntry[] {
  const out: ComponentEntry[] = [];
  const visit = (n: Node) => {
    if (n.reusable) {
      const name = n.name ?? n.id;
      const cut = name.indexOf(' / ');
      out.push({ id: prefix + n.id, name, group: cut > 0 ? name.slice(0, cut) : name, label: cut > 0 ? name.slice(cut + 3) : name });
    }
    for (const c of (n as { children?: Node[] }).children ?? []) visit(c);
  };
  doc.data.children.forEach(visit);
  return out;
}

/** Image of a node of the document at `path` (an `alias:id` draws a library's component). */
export const previewUrl = (path: string, id: string, version = 0) =>
  `/api/node-preview?${new URLSearchParams({ doc: path, id, size: '240', v: String(version), t: token() })}`;

/** The drag data type of a component dragged from the Components panel onto the canvas. */
export const COMPONENT_MIME = 'application/x-nib-component';
