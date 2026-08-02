/* =====================================================================
   editor/emoji-data.ts — a compact, bundled emoji keyword database (M4).

   Enough to make the picker searchable offline (Slack-style) without pulling
   in a multi-hundred-KB dataset. Covers the quick palette plus common
   searches; the OS emoji keyboard remains the full-universe fallback.
   ===================================================================== */

/** [glyph, space-separated keywords]. Keep glyphs unique. */
const DB: Array<[string, string]> = [
  ['😀', 'smile happy grin face'],
  ['😃', 'smile happy joy face'],
  ['😄', 'laugh happy smile face'],
  ['😁', 'grin beaming happy'],
  ['😆', 'laugh lol happy'],
  ['😅', 'sweat laugh nervous'],
  ['😂', 'cry laugh joy lol tears'],
  ['🙂', 'slight smile face hero'],
  ['😉', 'wink face'],
  ['😊', 'blush happy smile'],
  ['😎', 'cool sunglasses face'],
  ['🥸', 'disguise glasses face'],
  ['🤠', 'cowboy hat face'],
  ['🥳', 'party celebrate face'],
  ['🥶', 'cold freeze face'],
  ['🥵', 'hot heat face'],
  ['🤡', 'clown face creepy'],
  ['👻', 'ghost boo spooky halloween'],
  ['💀', 'skull dead bone death'],
  ['☠️', 'skull crossbones death poison'],
  ['👽', 'alien ufo space'],
  ['🤖', 'robot bot machine'],
  ['👿', 'devil angry imp villain'],
  ['😈', 'devil smile evil villain'],
  ['🤬', 'angry swear mad face'],
  ['😡', 'angry mad rage face'],
  ['😠', 'angry mad face'],
  ['🎃', 'pumpkin halloween jackolantern'],
  ['🐶', 'dog puppy pet animal'],
  ['🐱', 'cat kitten pet animal'],
  ['🦊', 'fox animal'],
  ['🐻', 'bear animal'],
  ['🐼', 'panda bear animal'],
  ['🐸', 'frog animal'],
  ['🦆', 'duck bird animal'],
  ['🐟', 'fish animal'],
  ['🐙', 'octopus sea animal'],
  ['🦀', 'crab sea animal'],
  ['🐢', 'turtle tortoise animal'],
  ['🦖', 'dino trex dinosaur'],
  ['🐉', 'dragon animal'],
  ['🕷️', 'spider bug animal'],
  ['🐝', 'bee bug insect'],
  ['🐛', 'bug caterpillar insect'],
  ['🦋', 'butterfly bug insect'],
  ['🌵', 'cactus plant desert'],
  ['🌲', 'tree evergreen plant'],
  ['🌳', 'tree plant'],
  ['🍄', 'mushroom fungus plant'],
  ['🌸', 'flower blossom pink'],
  ['🌻', 'sunflower flower'],
  ['🍉', 'watermelon fruit food'],
  ['🍎', 'apple fruit food red'],
  ['🍊', 'orange fruit food'],
  ['🍌', 'banana fruit food'],
  ['🍕', 'pizza food slice'],
  ['🍔', 'burger hamburger food'],
  ['🍩', 'donut doughnut food sweet'],
  ['🍪', 'cookie food sweet'],
  ['🎂', 'cake birthday food sweet'],
  ['🍰', 'cake slice food sweet'],
  ['⚽', 'soccer football ball sport'],
  ['🏀', 'basketball ball sport'],
  ['🏈', 'football ball sport'],
  ['⚾', 'baseball ball sport'],
  ['🎾', 'tennis ball sport'],
  ['🎳', 'bowling ball sport'],
  ['🎯', 'dart target bullseye aim'],
  ['🎲', 'dice game random'],
  ['🧨', 'firecracker explosive bomb boom'],
  ['💣', 'bomb explosive boom explode'],
  ['🧱', 'brick wall block build'],
  ['🪵', 'wood log lumber timber'],
  ['🪨', 'rock stone boulder'],
  ['⭐', 'star favorite'],
  ['🌟', 'star glowing sparkle'],
  ['🌙', 'moon night crescent'],
  ['☄️', 'comet meteor space'],
  ['⚡', 'lightning bolt electric zap'],
  ['🔥', 'fire flame hot burn'],
  ['❄️', 'snow ice cold snowflake'],
  ['💧', 'water drop droplet'],
  ['🌈', 'rainbow color'],
  ['💎', 'diamond gem jewel treasure'],
  ['🔔', 'bell ring alarm'],
  ['🎁', 'gift present box'],
  ['🏆', 'trophy win prize award'],
  ['🚗', 'car vehicle auto'],
  ['🚀', 'rocket space launch'],
  ['⚓', 'anchor boat sea heavy'],
  ['🛸', 'ufo alien saucer space'],
  ['🎈', 'balloon party float'],
  ['🪁', 'kite fly wind'],
  ['🧊', 'ice cube cold frozen'],
  ['🫧', 'bubbles soap foam'],
  ['🥊', 'boxing glove punch fight'],
  ['🛡️', 'shield protect defend guard'],
  ['⚔️', 'swords fight battle war'],
  ['🔮', 'crystal ball magic fortune'],
  ['🧲', 'magnet attract'],
  ['💰', 'money bag cash treasure'],
  ['👑', 'crown king queen royal'],
  ['💩', 'poop pile funny'],
  ['❤️', 'heart love red'],
  ['😇', 'angel halo innocent hostage'],
  ['🙃', 'upside down silly face'],
  ['🤖', 'robot bot'],
  ['🐷', 'pig animal'],
  ['🐮', 'cow animal'],
  ['🐔', 'chicken bird animal'],
  ['🦁', 'lion animal'],
  ['🐯', 'tiger animal'],
  ['🐵', 'monkey animal'],
  ['🦇', 'bat animal night'],
  ['🌞', 'sun sunny day'],
  ['🌊', 'wave water ocean sea'],
  ['🍒', 'cherry fruit food'],
  ['🥚', 'egg food'],
  ['🪙', 'coin money gold'],
];

export interface EmojiEntry {
  emoji: string;
  keywords: string;
}
export const EMOJI_DB: EmojiEntry[] = DB.map(([emoji, keywords]) => ({ emoji, keywords }));

/** Search the bundled DB by whitespace-separated tokens (all must match). */
export function searchEmoji(query: string, limit = 60): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/);
  const out: string[] = [];
  for (const e of EMOJI_DB) {
    if (tokens.every((t) => e.keywords.includes(t))) {
      out.push(e.emoji);
      if (out.length >= limit) break;
    }
  }
  return out;
}
