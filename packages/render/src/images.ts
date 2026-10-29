import type { CanvasKit, Image } from 'canvaskit-wasm';

/** Fetches encoded image bytes for an image fill `url`. Undefined when the image does not exist. */
export interface ImageLoader {
  load(url: string): Promise<Uint8Array | undefined>;
}

/** Placeholder urls written while `Generate` is still running. */
export const isPendingImage = (url: string) => url.startsWith('pencil:pending-image-') || url.startsWith('nib:pending-image-');

/** Decoded images, loaded on demand. */
export class ImageStore {
  private ck: CanvasKit;
  private loader: ImageLoader;
  private images = new Map<string, Promise<Image | undefined>>();
  private ready = new Map<string, Image>();
  private failed = new Map<string, string>();

  constructor(ck: CanvasKit, loader: ImageLoader) {
    this.ck = ck;
    this.loader = loader;
  }

  async ensure(urls: Iterable<string>): Promise<void> {
    const work: Promise<unknown>[] = [];
    for (const url of urls) {
      if (isPendingImage(url)) continue;
      let p = this.images.get(url);
      if (!p) {
        p = this.loader.load(url).then(
          (bytes) => {
            const img = bytes ? this.ck.MakeImageFromEncoded(bytes) ?? undefined : undefined;
            if (img) this.ready.set(url, img);
            else this.failed.set(url, bytes ? 'could not decode' : 'not found');
            return img;
          },
          (err: Error) => { this.failed.set(url, err.message); return undefined; },
        );
        this.images.set(url, p);
      }
      work.push(p);
    }
    await Promise.all(work);
  }

  get(url: string): Image | undefined {
    return this.ready.get(url);
  }

  /** Urls that could not be loaded, with the reason. */
  failures(): [string, string][] {
    return [...this.failed];
  }
}
