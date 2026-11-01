import { crc32, deflateRawSync } from 'node:zlib';

// A small kiwi encoder, the inverse of nib's decoder, and a Figma file made with it, for tests.
export type Def = { name: string; kind: 0 | 1 | 2; fields: { name: string; type: string; array?: boolean; id?: number }[] };
const BUILTIN: Record<string, number> = { bool: -1, byte: -2, int: -3, uint: -4, float: -5, string: -6, int64: -7, uint64: -8 };

class Writer {
  bytes: number[] = [];
  byte(v: number) { this.bytes.push(v & 255); }
  uint(v: number) { do { let b = v & 127; v >>>= 7; if (v) b |= 128; this.byte(b); } while (v); }
  int(v: number) { this.uint(((v << 1) ^ (v >> 31)) >>> 0); }
  float(v: number) {
    const f = new DataView(new ArrayBuffer(4));
    f.setFloat32(0, v, true);
    let bits = f.getUint32(0, true);
    bits = ((bits >>> 23) | (bits << 9)) >>> 0;
    if ((bits & 255) === 0) { this.byte(0); return; }
    this.byte(bits); this.byte(bits >>> 8); this.byte(bits >>> 16); this.byte(bits >>> 24);
  }
  string(s: string) { for (const b of new TextEncoder().encode(s)) this.byte(b); this.byte(0); }
  get out() { return new Uint8Array(this.bytes); }
}

export function encodeSchema(defs: Def[]): Uint8Array {
  const w = new Writer();
  w.uint(defs.length);
  for (const d of defs) {
    w.string(d.name);
    w.byte(d.kind);
    w.uint(d.fields.length);
    d.fields.forEach((f, i) => {
      w.string(f.name);
      w.int(f.type in BUILTIN ? BUILTIN[f.type] : defs.findIndex((x) => x.name === f.type));
      w.byte(f.array ? 1 : 0);
      w.uint(f.id ?? i + 1);
    });
  }
  return w.out;
}

export function encodeMessage(defs: Def[], type: string, value: unknown): Uint8Array {
  const w = new Writer();
  const one = (t: string, v: unknown): void => {
    switch (t) {
      case 'bool': w.byte(v ? 1 : 0); return;
      case 'byte': w.byte(v as number); return;
      case 'int': w.int(v as number); return;
      case 'uint': w.uint(v as number); return;
      case 'float': w.float(v as number); return;
      case 'string': w.string(v as string); return;
    }
    const d = defs.find((x) => x.name === t)!;
    if (d.kind === 0) { w.uint(d.fields.find((f) => f.name === v)!.id!); return; }
    const rec = v as Record<string, unknown>;
    for (const f of d.fields) {
      if (d.kind === 2) { if (rec[f.name] === undefined) continue; w.uint(f.id!); }
      const x = rec[f.name];
      if (!f.array) one(f.type, x);
      else if (f.type === 'byte') { const b = x as Uint8Array; w.uint(b.length); for (const c of b) w.byte(c); }
      else { const list = x as unknown[]; w.uint(list.length); for (const item of list) one(f.type, item); }
    }
    if (d.kind === 2) w.uint(0);
  };
  one(type, value);
  return w.out;
}

const enumOf = (name: string, values: string[]): Def => ({ name, kind: 0, fields: values.map((v, i) => ({ name: v, type: 'uint', id: i })) });
const struct = (name: string, fields: [string, string][]): Def => ({ name, kind: 1, fields: fields.map(([n, type]) => ({ name: n, type })) });
export const message = (name: string, fields: [string, string, boolean?][]): Def => ({ name, kind: 2, fields: fields.map(([n, type, array], i) => ({ name: n, type, array, id: i + 1 })) });

// The part of Figma's schema these tests use, with Figma's names.
const SCHEMA: Def[] = [
  enumOf('NodeType', ['NONE', 'DOCUMENT', 'CANVAS', 'GROUP', 'FRAME', 'VECTOR', 'RECTANGLE', 'TEXT', 'SYMBOL', 'INSTANCE', 'VARIABLE_SET', 'VARIABLE']),
  enumOf('PaintType', ['SOLID', 'GRADIENT_LINEAR', 'IMAGE']),
  enumOf('StackMode', ['NONE', 'HORIZONTAL', 'VERTICAL']),
  enumOf('StackSize', ['FIXED', 'RESIZE_TO_FIT']),
  enumOf('TextAutoResize', ['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT']),
  enumOf('EffectType', ['DROP_SHADOW', 'INNER_SHADOW']),
  enumOf('ScaleMode', ['FILL', 'FIT']),
  enumOf('VariableResolvedType', ['COLOR', 'FLOAT']),
  struct('GUID', [['sessionID', 'uint'], ['localID', 'uint']]),
  struct('Color', [['r', 'float'], ['g', 'float'], ['b', 'float'], ['a', 'float']]),
  struct('Vector', [['x', 'float'], ['y', 'float']]),
  struct('Matrix', [['m00', 'float'], ['m01', 'float'], ['m02', 'float'], ['m10', 'float'], ['m11', 'float'], ['m12', 'float']]),
  message('ParentIndex', [['guid', 'GUID'], ['position', 'string']]),
  message('VariableAnyValue', [['alias', 'VariableID'], ['colorValue', 'Color'], ['floatValue', 'float']]),
  message('VariableID', [['guid', 'GUID']]),
  message('VariableData', [['value', 'VariableAnyValue']]),
  message('Image', [['hash', 'byte', true]]),
  message('Paint', [['type', 'PaintType'], ['color', 'Color'], ['opacity', 'float'], ['visible', 'bool'], ['image', 'Image'], ['imageScaleMode', 'ScaleMode'], ['colorVar', 'VariableData'], ['stops', 'ColorStop', true], ['transform', 'Matrix']]),
  message('ColorStop', [['color', 'Color'], ['position', 'float']]),
  message('Effect', [['type', 'EffectType'], ['color', 'Color'], ['offset', 'Vector'], ['radius', 'float'], ['visible', 'bool']]),
  message('FontName', [['family', 'string'], ['style', 'string']]),
  message('TextData', [['characters', 'string']]),
  message('VectorData', [['vectorNetworkBlob', 'uint'], ['normalizedSize', 'Vector']]),
  message('GUIDPath', [['guids', 'GUID', true]]),
  message('SymbolOverride', [['guidPath', 'GUIDPath'], ['textData', 'TextData']]),
  message('SymbolData', [['symbolID', 'GUID'], ['symbolOverrides', 'SymbolOverride', true]]),
  message('VariableSetMode', [['id', 'GUID'], ['name', 'string'], ['sortPosition', 'string']]),
  message('VariableDataValuesEntry', [['modeID', 'GUID'], ['variableData', 'VariableData']]),
  message('VariableDataValues', [['entries', 'VariableDataValuesEntry', true]]),
  message('VariableModeBySetMapEntry', [['variableSetID', 'VariableID'], ['variableModeID', 'GUID']]),
  message('VariableModeBySetMap', [['entries', 'VariableModeBySetMapEntry', true]]),
  message('NodeChange', [
    ['guid', 'GUID'], ['parentIndex', 'ParentIndex'], ['type', 'NodeType'], ['name', 'string'], ['visible', 'bool'], ['size', 'Vector'],
    ['transform', 'Matrix'], ['fillPaints', 'Paint', true], ['effects', 'Effect', true], ['cornerRadius', 'float'],
    ['stackMode', 'StackMode'], ['stackSpacing', 'float'], ['stackHorizontalPadding', 'float'], ['stackVerticalPadding', 'float'],
    ['stackPaddingRight', 'float'], ['stackPaddingBottom', 'float'], ['stackPrimarySizing', 'StackSize'], ['stackCounterSizing', 'StackSize'],
    ['textData', 'TextData'], ['fontName', 'FontName'], ['fontSize', 'float'], ['textAutoResize', 'TextAutoResize'],
    ['vectorData', 'VectorData'], ['symbolData', 'SymbolData'], ['internalOnly', 'bool'], ['frameMaskDisabled', 'bool'],
    ['variableSetModes', 'VariableSetMode', true], ['variableSetID', 'VariableID'], ['variableResolvedType', 'VariableResolvedType'],
    ['variableDataValues', 'VariableDataValues'], ['variableModeBySetMap', 'VariableModeBySetMap'], ['stackChildAlignSelf', 'string'],
  ]),
  message('Blob', [['bytes', 'byte', true]]),
  message('Message', [['nodeChanges', 'NodeChange', true], ['blobs', 'Blob', true]]),
];

const g = (sessionID: number, localID: number) => ({ sessionID, localID });
const at = (parent: { sessionID: number; localID: number }, position: string) => ({ guid: parent, position });
const move = (x: number, y: number, deg = 0) => {
  const r = (deg * Math.PI) / 180;
  return { m00: Math.cos(r), m01: Math.sin(r), m02: x, m10: -Math.sin(r), m11: Math.cos(r), m12: y };
};
const solid = (r: number, gg: number, b: number) => ({ type: 'SOLID', color: { r, g: gg, b, a: 1 }, opacity: 1, visible: true });

/** A vector network: a triangle (three vertices, three straight segments, one closed region). */
function triangle(): Uint8Array {
  const b = new DataView(new ArrayBuffer(12 + 3 * 12 + 3 * 28 + 8 + 4 + 12));
  let o = 0;
  const u = (v: number) => { b.setUint32(o, v, true); o += 4; };
  const f = (v: number) => { b.setFloat32(o, v, true); o += 4; };
  u(3); u(3); u(1);
  for (const [x, y] of [[5, 0], [10, 10], [0, 10]]) { u(0); f(x); f(y); }
  for (const [s, e] of [[0, 1], [1, 2], [2, 0]]) { u(0); u(s); f(0); f(0); u(e); f(0); f(0); }
  u(1); u(1); u(3); u(0); u(1); u(2);
  return new Uint8Array(b.buffer);
}

export const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
export const PICTURE_HASH = new Uint8Array(20).map((_, i) => i + 1);

function figmaDocument(): unknown {
  const doc = g(0, 0), page = g(0, 1), internal = g(0, 2), page2 = g(0, 3);
  const set = g(5, 1), light = g(5, 2), dark = g(5, 3), bg = g(5, 4);
  return {
    nodeChanges: [
      { guid: doc, type: 'DOCUMENT', name: 'Document' },
      { guid: page, parentIndex: at(doc, '!'), type: 'CANVAS', name: 'Page 1' },
      { guid: internal, parentIndex: at(doc, '"'), type: 'CANVAS', name: 'Internal', internalOnly: true },
      { guid: page2, parentIndex: at(doc, '#'), type: 'CANVAS', name: 'Page 2' },
      { guid: set, parentIndex: at(internal, '!'), type: 'VARIABLE_SET', name: 'Theme', variableSetModes: [{ id: light, name: 'Light', sortPosition: '!' }, { id: dark, name: 'Dark', sortPosition: '"' }] },
      {
        guid: bg, parentIndex: at(internal, '"'), type: 'VARIABLE', name: 'color/bg', variableSetID: { guid: set }, variableResolvedType: 'COLOR',
        variableDataValues: { entries: [{ modeID: light, variableData: { value: { colorValue: { r: 1, g: 1, b: 1, a: 1 } } } }, { modeID: dark, variableData: { value: { colorValue: { r: 0, g: 0, b: 0, a: 1 } } } }] },
      },
      {
        guid: g(1, 1), parentIndex: at(page, '!'), type: 'FRAME', name: 'Card', size: { x: 200, y: 120 }, transform: move(100, 50),
        fillPaints: [{ ...solid(1, 1, 1), colorVar: { value: { alias: { guid: bg } } } }], cornerRadius: 12,
        effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 12, visible: true }],
        stackMode: 'VERTICAL', stackSpacing: 8, stackHorizontalPadding: 16, stackVerticalPadding: 16, stackPaddingRight: 16, stackPaddingBottom: 16,
        stackPrimarySizing: 'RESIZE_TO_FIT', stackCounterSizing: 'FIXED',
        variableModeBySetMap: { entries: [{ variableSetID: { guid: set }, variableModeID: dark }] },
      },
      { guid: g(1, 2), parentIndex: at(g(1, 1), '!'), type: 'TEXT', name: 'Title', size: { x: 60, y: 24 }, transform: move(16, 16), textData: { characters: 'Hello' }, fontName: { family: 'Inter', style: 'Bold' }, fontSize: 20, textAutoResize: 'WIDTH_AND_HEIGHT', fillPaints: [solid(0.1, 0.1, 0.1)] },
      { guid: g(1, 3), parentIndex: at(g(1, 1), '"'), type: 'VECTOR', name: 'Check', size: { x: 20, y: 20 }, transform: move(16, 48), fillPaints: [solid(0, 0.5, 0)], vectorData: { vectorNetworkBlob: 0, normalizedSize: { x: 10, y: 10 } }, stackChildAlignSelf: 'STRETCH' },
      { guid: g(1, 10), parentIndex: at(page, '"'), type: 'SYMBOL', name: 'Button', size: { x: 80, y: 32 }, transform: move(400, 50), fillPaints: [solid(0.2, 0.4, 1)], frameMaskDisabled: true },
      { guid: g(1, 11), parentIndex: at(g(1, 10), '!'), type: 'TEXT', name: 'Label', size: { x: 40, y: 18 }, transform: move(20, 7), textData: { characters: 'Label' }, fontName: { family: 'Inter', style: 'Regular' }, fontSize: 14, textAutoResize: 'WIDTH_AND_HEIGHT' },
      { guid: g(1, 20), parentIndex: at(page, '#'), type: 'INSTANCE', name: 'Button', size: { x: 80, y: 32 }, transform: move(400, 120), symbolData: { symbolID: g(1, 10), symbolOverrides: [{ guidPath: { guids: [g(1, 11)] }, textData: { characters: 'Buy' } }] } },
      { guid: g(1, 30), parentIndex: at(page, '$'), type: 'RECTANGLE', name: 'Tilted', size: { x: 40, y: 40 }, transform: move(600, 50, 30), fillPaints: [{ type: 'IMAGE', image: { hash: PICTURE_HASH }, imageScaleMode: 'FIT', opacity: 1, visible: true }] },
      { guid: g(2, 1), parentIndex: at(page2, '!'), type: 'FRAME', name: 'Second page', size: { x: 100, y: 100 }, transform: move(0, 0), fillPaints: [solid(1, 0, 0)] },
    ],
    blobs: [{ bytes: triangle() }],
  };
}

/** A zip of stored entries. */
function zip(entries: Record<string, Uint8Array>): Uint8Array {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt32LE(crc32(data), 16);
    dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42);
    parts.push(local, n, Buffer.from(data));
    central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}

export function figFile(): Uint8Array {
  const chunk = (b: Uint8Array) => { const c = deflateRawSync(b); const len = Buffer.alloc(4); len.writeUInt32LE(c.length); return Buffer.concat([len, c]); };
  const header = Buffer.alloc(12);
  header.write('fig-kiwi', 0, 'latin1');
  header.writeUInt32LE(70, 8);
  const canvas = new Uint8Array(Buffer.concat([header, chunk(encodeSchema(SCHEMA)), chunk(encodeMessage(SCHEMA, 'Message', figmaDocument()))]));
  return zip({ 'canvas.fig': canvas, 'meta.json': new TextEncoder().encode('{"version":1}'), [`images/${Buffer.from(PICTURE_HASH).toString('hex')}`]: PICTURE });
}

