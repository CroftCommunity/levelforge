/* =====================================================================
   editor/sprites.ts — custom emoji sprite image cache (M4).

   object.sprite is a custom image skin for an emoji body (physics stays a
   circle of r). In the deployed app a sprite is either a committed file path
   under the level's sprites/ folder or, for in-app authoring, an inline
   dataURL — both are just strings passed here. Images load lazily; render
   falls back to the emoji glyph until one is ready.
   ===================================================================== */

interface Entry {
  img: HTMLImageElement;
  ready: boolean;
  broken: boolean;
}
const cache = new Map<string, Entry>();

/** Return a loaded sprite image for src, or null until it's ready / on error. */
export function getSpriteImg(src: string): HTMLImageElement | null {
  let e = cache.get(src);
  if (!e) {
    const img = new Image();
    e = { img, ready: false, broken: false };
    img.onload = () => {
      e!.ready = true;
    };
    img.onerror = () => {
      e!.broken = true;
    };
    img.src = src;
    cache.set(src, e);
  }
  return e.ready && !e.broken ? e.img : null;
}
