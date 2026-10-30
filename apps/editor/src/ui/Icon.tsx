import { ICONS, type IconName } from './icons.ts';

/** A lucide icon drawn in the current text color. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const svg = ICONS[name].replace(/width="24"/, `width="${size}"`).replace(/height="24"/, `height="${size}"`).replace(/stroke-width="2"/, 'stroke-width="1.75"');
  return <span className="icon" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}
