/**
 * Kiwi, the binary format Figma files use: a schema (itself encoded in kiwi's binary schema format) and a
 * message encoded with it. Written from kiwi's public specification; decoding only.
 */

export interface KiwiField { name: string; type: string; isArray: boolean; value: number }
export interface KiwiDefinition { name: string; kind: 'enum' | 'struct' | 'message'; fields: KiwiField[] }
export interface KiwiSchema { definitions: KiwiDefinition[]; byName: Map<string, KiwiDefinition> }

const BUILTIN: Record<number, string> = { [-1]: 'bool', [-2]: 'byte', [-3]: 'int', [-4]: 'uint', [-5]: 'float', [-6]: 'string', [-7]: 'int64', [-8]: 'uint64' };
const KINDS = ['enum', 'struct', 'message'] as const;

class Reader {
  private at = 0;
  private view: DataView;
  private bytes: Uint8Array;
  constructor(bytes: Uint8Array) { this.bytes = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  byte(): number {
    if (this.at >= this.bytes.length) throw new Error('kiwi: read past the end');
    return this.bytes[this.at++];
  }
  bool(): boolean { return this.byte() !== 0; }
  uint(): number {
    let value = 0, shift = 0, b: number;
    do { b = this.byte(); value |= (b & 127) << shift; shift += 7; } while (b & 128 && shift < 35);
    return value >>> 0;
  }
  int(): number { const v = this.uint(); return v & 1 ? ~(v >>> 1) : v >>> 1; }
  uint64(): bigint {
    let value = 0n, shift = 0n, b: number;
    do { b = this.byte(); value |= BigInt(b & 127) << shift; shift += 7n; } while (b & 128 && shift < 70n);
    return value;
  }
  int64(): bigint { const v = this.uint64(); return v & 1n ? ~(v >> 1n) : v >> 1n; }
  /** Kiwi floats are 0 as one byte, else 4 bytes with the exponent moved to the front. */
  float(): number {
    const first = this.byte();
    if (first === 0) return 0;
    const bits = first | (this.byte() << 8) | (this.byte() << 16) | (this.byte() << 24);
    this.view.setUint32(this.at - 4, ((bits << 23) | (bits >>> 9)) >>> 0, true);
    const f = this.view.getFloat32(this.at - 4, true);
    this.view.setUint32(this.at - 4, bits >>> 0, true);
    return f;
  }
  string(): string {
    const start = this.at;
    while (this.byte() !== 0) { /* to the terminating zero */ }
    return new TextDecoder().decode(this.bytes.subarray(start, this.at - 1));
  }
  bytesOf(n: number): Uint8Array { const out = this.bytes.slice(this.at, this.at + n); this.at += n; if (out.length < n) throw new Error('kiwi: read past the end'); return out; }
}

export function decodeSchema(bytes: Uint8Array): KiwiSchema {
  const r = new Reader(bytes);
  const definitions: KiwiDefinition[] = [];
  const pending: { field: KiwiField; type: number }[] = [];
  for (let i = r.uint(); i > 0; i--) {
    const name = r.string();
    const kind = KINDS[r.byte()];
    if (!kind) throw new Error(`kiwi: definition ${name} has an unknown kind`);
    const fields: KiwiField[] = [];
    for (let j = r.uint(); j > 0; j--) {
      const field: KiwiField = { name: r.string(), type: '', isArray: false, value: 0 };
      const type = r.int();
      field.isArray = !!(r.byte() & 1);
      field.value = r.uint();
      pending.push({ field, type });
      fields.push(field);
    }
    definitions.push({ name, kind, fields });
  }
  for (const { field, type } of pending) {
    const t = type < 0 ? BUILTIN[type] : definitions[type]?.name;
    if (!t) throw new Error(`kiwi: field ${field.name} has an unknown type`);
    field.type = t;
  }
  return { definitions, byName: new Map(definitions.map((d) => [d.name, d])) };
}

export type KiwiValue = unknown;

/** A message of type `root` (Figma files: "Message"), as plain objects; byte arrays as Uint8Array, 64-bit numbers as bigint. */
export function decodeMessage(schema: KiwiSchema, bytes: Uint8Array, root: string): Record<string, KiwiValue> {
  const r = new Reader(bytes);
  const one = (type: string): KiwiValue => {
    switch (type) {
      case 'bool': return r.bool();
      case 'byte': return r.byte();
      case 'int': return r.int();
      case 'uint': return r.uint();
      case 'float': return r.float();
      case 'string': return r.string();
      case 'int64': return r.int64();
      case 'uint64': return r.uint64();
    }
    const def = schema.byName.get(type);
    if (!def) throw new Error(`kiwi: no type ${type}`);
    if (def.kind === 'enum') {
      const v = r.uint();
      return def.fields.find((f) => f.value === v)?.name ?? v;
    }
    const out: Record<string, KiwiValue> = {};
    if (def.kind === 'struct') {
      for (const f of def.fields) out[f.name] = field(f);
      return out;
    }
    for (;;) {
      const id = r.uint();
      if (id === 0) return out;
      const f = def.fields.find((x) => x.value === id);
      if (!f) throw new Error(`kiwi: ${def.name} has no field ${id}`);
      out[f.name] = field(f);
    }
  };
  const field = (f: KiwiField): KiwiValue => {
    if (!f.isArray) return one(f.type);
    const n = r.uint();
    if (f.type === 'byte') return r.bytesOf(n);
    const list: KiwiValue[] = [];
    for (let i = 0; i < n; i++) list.push(one(f.type));
    return list;
  };
  return one(root) as Record<string, KiwiValue>;
}
