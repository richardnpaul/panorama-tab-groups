/** The part of an image element that is used */
export interface ImageLike {
  src: string;
  readonly width: number;
  readonly height: number;
  onload: ((event: Event) => void) | null;
  onerror: ((event: Event | string) => void) | null;
}

/** The part of a 2D drawing surface that is used */
export interface SurfaceLike<Image extends ImageLike> {
  drawImage: (
    image: Image,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
}

/** The part of a canvas element that is used */
export interface CanvasLike<Image extends ImageLike> {
  width: number;
  height: number;
  getContext: (type: '2d') => SurfaceLike<Image> | null;
  toDataURL: (type: 'image/jpeg', quality: number) => string;
}

export interface ImagingEnvironment<Image extends ImageLike> {
  newImage: () => Image;
  newCanvas: () => CanvasLike<Image>;
}

// How wide a thumbnail is, in pixels, and how well it is compressed
const THUMBNAIL_WIDTH = 500;
const THUMBNAIL_QUALITY = 0.7;

/** A picture of a tab, made 500 pixels wide, as a small JPEG image address */
export function createThumbnailShrinker<Image extends ImageLike>({
  newImage,
  newCanvas,
}: ImagingEnvironment<Image>): (picture: string) => Promise<string> {
  return (picture) =>
    new Promise<string>((resolve, reject) => {
      const image = newImage();

      image.onerror = () => {
        reject(new Error('The picture of the tab could not be loaded'));
      };
      image.onload = () => {
        const canvas = newCanvas();
        const surface = canvas.getContext('2d');
        if (surface === null) {
          reject(new Error('A canvas cannot be drawn on here'));
          return;
        }

        canvas.width = THUMBNAIL_WIDTH;
        canvas.height = THUMBNAIL_WIDTH * (image.height / image.width);
        surface.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY));
      };
      image.src = picture;
    });
}

/**
 * Whether a picture can be loaded as the icon of a tab. Loading can be slow
 * where another extension has a web request listener on this page.
 */
export function createImageLoader(
  newImage: () => ImageLike,
): (url: string) => Promise<void> {
  return (url) =>
    new Promise<void>((resolve, reject) => {
      const image = newImage();

      image.onerror = () => {
        reject(new Error(`The image ${url} could not be loaded`));
      };
      image.onload = () => {
        resolve();
      };
      image.src = url;
    });
}
