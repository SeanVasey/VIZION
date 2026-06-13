/**
 * Framework-free helpers for the avatar cropper (product-spec §3.3 / §5.2).
 *
 * The component lets the user pan/zoom an image inside a square viewport that is
 * displayed under a circular CSS mask.  The actual output is always a SQUARE PNG
 * — the circular look is purely a display concern (`rounded-full`).  Everything
 * here is pure and SSR-safe so the math can be unit-tested without a DOM canvas.
 */

/**
 * User-controlled crop state.  `offsetX`/`offsetY` are pan offsets expressed in
 * *displayed* pixels relative to the image's centered position (0,0 = centered).
 */
export interface CropTransform {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/** Edge length (px) of the square PNG we render. */
export const OUTPUT_SIZE = 512;

/**
 * Clamp a pan offset to the inclusive range [-max, +max] so the image can never
 * be dragged far enough to expose an empty edge inside the crop window.  A
 * non-positive `max` pins the offset to 0 (image exactly fills the viewport, or
 * is smaller than it — nothing to pan).
 */
export function clampOffset(value: number, max: number): number {
  if (max <= 0) return 0;
  if (value > max) return max;
  if (value < -max) return -max;
  return value;
}

/**
 * Compute how far (in viewport px) the scaled image may pan along one axis while
 * still completely covering the square viewport.
 *
 * The image is first laid out to *cover* the viewport (its smaller natural side
 * maps to `viewport`), then multiplied by `zoom`.  The slack on each side is half
 * the overflow beyond the viewport.  Never negative: when the scaled image is no
 * larger than the viewport there is nothing to pan.
 *
 * @param naturalSize  the image's natural length on this axis (px)
 * @param displaySize  the image's *other-axis* natural length used to derive the
 *                     base cover-scale (the smaller natural side fills `viewport`)
 * @param zoom         user zoom multiplier (>= 1)
 * @param viewport     square viewport edge length (px)
 */
export function computeMaxOffset(
  naturalSize: number,
  displaySize: number,
  zoom: number,
  viewport: number,
): number {
  if (naturalSize <= 0 || displaySize <= 0 || viewport <= 0) return 0;

  // Base "cover" scale: the smaller natural side is the one that constrains the
  // fit, so it maps exactly onto the viewport edge.
  const minNatural = Math.min(naturalSize, displaySize);
  const coverScale = viewport / minNatural;

  // Scaled length of this axis in viewport px, including user zoom.
  const scaledSize = naturalSize * coverScale * zoom;

  // Half the overflow beyond the viewport is the per-side pan slack.
  const slack = (scaledSize - viewport) / 2;
  return slack > 0 ? slack : 0;
}

/**
 * Draw the currently visible square region to an offscreen OUTPUT_SIZE canvas
 * and return it as a PNG Blob.  Output is square; the circular appearance is
 * applied at display time via CSS.
 *
 * Guards against SSR (no `document`/`OffscreenCanvas`) and a missing 2d context.
 */
export async function renderCroppedBlob(
  image: HTMLImageElement | ImageBitmap,
  viewport: number,
  transform: CropTransform,
): Promise<Blob> {
  if (typeof document === "undefined" && typeof OffscreenCanvas === "undefined") {
    throw new Error("renderCroppedBlob requires a browser environment");
  }
  if (viewport <= 0) {
    throw new Error("viewport must be positive");
  }

  // Natural dimensions: HTMLImageElement exposes naturalWidth/Height, ImageBitmap
  // exposes width/height.
  const naturalWidth = "naturalWidth" in image ? image.naturalWidth : image.width;
  const naturalHeight = "naturalHeight" in image ? image.naturalHeight : image.height;
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    throw new Error("image has no intrinsic dimensions");
  }

  // Reproduce the on-screen layout math, then scale from viewport px to output px.
  const minNatural = Math.min(naturalWidth, naturalHeight);
  const coverScale = (viewport / minNatural) * transform.zoom;
  const drawWidth = naturalWidth * coverScale;
  const drawHeight = naturalHeight * coverScale;

  // Clamp the pan so the image always covers the viewport (defensive — the UI
  // already clamps, but the helper must stay correct on its own).
  const maxX = (drawWidth - viewport) / 2;
  const maxY = (drawHeight - viewport) / 2;
  const offsetX = clampOffset(transform.offsetX, maxX);
  const offsetY = clampOffset(transform.offsetY, maxY);

  // Top-left of the drawn image relative to the viewport's top-left, in viewport
  // px.  The image is centered (so its top-left sits at the centering offset)
  // then shifted by the pan offset.
  const imageLeft = (viewport - drawWidth) / 2 + offsetX;
  const imageTop = (viewport - drawHeight) / 2 + offsetY;

  // Scale everything from viewport px up to the OUTPUT_SIZE canvas.
  const scale = OUTPUT_SIZE / viewport;

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(OUTPUT_SIZE, OUTPUT_SIZE)
      : Object.assign(document.createElement("canvas"), {
          width: OUTPUT_SIZE,
          height: OUTPUT_SIZE,
        });

  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) {
    throw new Error("2d canvas context is unavailable");
  }

  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    imageLeft * scale,
    imageTop * scale,
    drawWidth * scale,
    drawHeight * scale,
  );

  // OffscreenCanvas → convertToBlob; HTMLCanvasElement → toBlob.
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob produced no blob"));
    }, "image/png");
  });
}
