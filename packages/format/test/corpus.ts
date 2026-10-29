import fs from 'node:fs';

/** Real-world .pen files, listed one path per line in the file named by NIB_CORPUS (never committed). */
export const corpusFiles: string[] = (() => {
  const list = process.env.NIB_CORPUS;
  if (!list || !fs.existsSync(list)) return [];
  return fs.readFileSync(list, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && fs.existsSync(l));
})();

export const readCorpus = (file: string) => fs.readFileSync(file, 'utf8');
