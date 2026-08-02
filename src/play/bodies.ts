/* =====================================================================
   play/bodies.ts — build one Matter.Body from a level object.

   Shared by the slingshot Test runtime (world.ts) and the drive runtime
   (drive.ts). Materials carry the physics; blobs become compound circle
   bodies; anchored/pathed pieces are static.
   ===================================================================== */

import Matter from 'matter-js';
import { LevelObject, BRUSH_DEFAULT } from '../schema';
import { MATERIALS } from '../materials';
import { triVerts } from '../editor/geometry';

const { Bodies, Body } = Matter;
const DEG = 180 / Math.PI;

export function makeMatterBody(o: LevelObject): Matter.Body {
  const m = MATERIALS[o.material];
  const opts: Matter.IBodyDefinition = {
    density: m.density,
    friction: m.friction,
    restitution: m.restitution,
    angle: (o.angle || 0) / DEG,
    isStatic: !!o.anchored || !!o.path,
  };
  if (o.shape === 'box') return Bodies.rectangle(o.x, o.y, o.w!, o.h!, opts);
  if (o.shape === 'tri') return Bodies.fromVertices(o.x, o.y, [triVerts({ w: o.w!, h: o.h! })], opts);
  if (o.shape === 'blob') {
    const r = o.brushR ?? BRUSH_DEFAULT;
    const pts = o.pts ?? [];
    const parts = pts.map(([rx, ry]) => Bodies.circle(o.x + rx, o.y + ry, r, { ...opts, isStatic: false }));
    const b = parts.length === 1 ? parts[0] : Body.create({ parts });
    Body.setPosition(b, { x: o.x, y: o.y });
    if (o.angle) Body.setAngle(b, o.angle / DEG);
    Body.setStatic(b, !!opts.isStatic);
    return b;
  }
  return Bodies.circle(o.x, o.y, o.r!, opts);
}
