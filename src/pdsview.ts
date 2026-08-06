/* =====================================================================
   pdsview.ts — build deep links into pdsview.croft.ing, the croft.ing PDS
   content viewer, so a saved level (and the level lexicon) can be read as a
   rendered record instead of raw JSON.

   pdsview is DID-canonical: every route it accepts carries a real DID, a
   collection NSID, and (optionally) a record key —
       https://pdsview.croft.ing/#/at/<did>/<collection>/<rkey>
   It resolves that repo live over the network and renders whatever is there.

   levelforge, by contrast, is an offline-first PWA that publishes nothing on
   its own. So until a repo DID is wired in below, these links have no live
   record to resolve and the UI presents them as a *preview* rather than a
   working "verify on your PDS" jump. Fill PDS_DID in with the real repo DID
   the moment levels start being published and every link goes live — no other
   change needed. This is the single configuration point.
   ===================================================================== */

const PDS_VIEW_ORIGIN = 'https://pdsview.croft.ing';

/* ---- the one thing to configure -------------------------------------- */
// TODO(pds): replace with the real repo DID once levels are published to a PDS.
// While it still contains REPLACEME, isConfigured() is false and links render
// as previews. A DID looks like `did:plc:abcdefghijklmnopqrstuvwx`.
export const PDS_DID = 'did:plc:REPLACEME0000000000000000';

/** Collection (NSID) that level records live under, reverse-DNS of croft.ing. */
export const PDS_LEVEL_COLLECTION = 'ing.croft.levelforge.level';
/** Where a published atproto lexicon lives: the standard schema collection,
    keyed by the lexicon's own NSID. */
export const PDS_LEXICON_COLLECTION = 'com.atproto.lexicon.schema';
export const PDS_LEXICON_NSID = 'ing.croft.levelforge.level';

const DID_RE = /^did:[a-z]+:[A-Za-z0-9._%:-]+$/;

/** True once a real DID is wired in, so links resolve to live PDS records.
    Until then the placeholder trips this and the UI marks links as previews. */
export function isConfigured(): boolean {
  return DID_RE.test(PDS_DID) && !PDS_DID.includes('REPLACEME');
}

/** Build a pdsview URL, mirroring its `#/at/<did>/<collection>/<rkey>` routing. */
function atUrl(collection: string, rkey?: string): string {
  let route = `#/at/${PDS_DID}/${collection}`;
  if (rkey !== undefined) route += `/${encodeURIComponent(rkey)}`;
  return `${PDS_VIEW_ORIGIN}/${route}`;
}

/** Slugify a level name into a stable-ish record key. */
export function rkeyForLevel(name: string): string {
  const slug = String(name || 'level')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'level';
}

/** Link to a single saved level, viewed on the PDS. */
export function levelUrl(name: string): string {
  return atUrl(PDS_LEVEL_COLLECTION, rkeyForLevel(name));
}

/** Link to the level lexicon (the schema) rendered by pdsview. */
export function lexiconUrl(): string {
  return atUrl(PDS_LEXICON_COLLECTION, PDS_LEXICON_NSID);
}
