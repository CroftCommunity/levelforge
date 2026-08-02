/* =====================================================================
   play/tuning.ts — the feel constants for the jump-based modes.

   These are PHONE-TUNED PLACEHOLDERS. The spec is explicit: the hop impulse,
   the grounded/coyote window, and (for bounce) the roll ramp are feel-critical
   and must be validated on a real phone, never trusted from desktop. Nothing
   outside this file hardcodes them — change the number here and every mode
   follows.
   ===================================================================== */

/** Jump impulse for drop's tap-to-hop: velocity.y is set to -HOP, x kept.
    World units per physics step (matches the ~12–13 scale of the runtime). */
export const HOP = 13;

/** Grace window (ms) after the last grounded contact during which a tap still
    hops. Covers input latency and coyote time (hopping just after rolling off
    an edge). Shared by drop and bounce. */
export const COYOTE_MS = 130;

/** Bounce jump velocity. May simply share HOP until phone testing says
    otherwise. */
export const JUMP = HOP;

/** Bounce roll: cap on |angular velocity| the hold-a-side control ramps toward
    (rad/tick-scale), and the per-tick acceleration of that ramp. Torque-style,
    so slopes and momentum stay physical. Bounce mode owns these. */
export const MAX_ROLL = 0.45;
export const ROLL_ACCEL = 0.05;

/** Bounce tap-vs-hold discriminator: a press released within TAP_MS (with
    little movement) is a jump, not a steer. */
export const TAP_MS = 180;
