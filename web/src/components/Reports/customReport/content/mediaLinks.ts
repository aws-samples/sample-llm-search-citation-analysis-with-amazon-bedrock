/**
 * Link rules for image and video blocks, the client-side mirror of
 * `_https_link` and `_is_embeddable_video` in
 * `lambda/api/manage-custom-reports.py`. `test-fixtures/custom-report-blocks.json`
 * holds the vectors both sides must agree on.
 *
 * A media link is at most `MAX_MEDIA_URL_LENGTH` characters once trimmed,
 * written as `https://` with a host, no credentials, no port 0 and no blank
 * or control character inside (nor a backslash, which browsers read as a
 * slash). Videos are only embedded from YouTube (through the
 * privacy-enhanced youtube-nocookie.com player) and Vimeo (with
 * do-not-track), never from a link carrying an explicit port.
 *
 * Host, path and query are matched as written, like Python's `urlsplit`:
 * `new URL` would normalise them (drop `:443`, resolve `/./`, map look-alike
 * characters to ASCII) and accept links the server refuses.
 */

export const MAX_MEDIA_URL_LENGTH = 2048;

/** Authority, path and query as written; the scheme is matched case-insensitively. */
const WRITTEN_PARTS = /^https:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i;

interface MediaLink {
  /** Host and port as written, lowercased. */
  readonly authority: string;
  readonly path: string;
  readonly query: string;
}

type EmbedReader = (link: MediaLink) => string | null;

function isBlankOrControl(character: string): boolean {
  const code = character.charCodeAt(0);
  return /\s/.test(character) || code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

function hasAcceptedCharacters(text: string): boolean {
  return text.length > 0
    && text.length <= MAX_MEDIA_URL_LENGTH
    && !text.includes('\\')
    && !Array.from(text).some(isBlankOrControl);
}

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function parseMediaLink(url: string): MediaLink | null {
  const trimmed = url.trim();
  const parts = hasAcceptedCharacters(trimmed) ? WRITTEN_PARTS.exec(trimmed) : null;
  const parsed = parts === null ? null : parseUrl(trimmed);
  if (parts === null || parsed === null) return null;
  const [, authority, path, query = ''] = parts;
  if (authority === '' || authority.includes('@') || parsed.port === '0') return null;
  return {
    authority: authority.toLowerCase(),
    path,
    query,
  };
}

function captured(pattern: RegExp, text: string): string | null {
  return pattern.exec(text)?.[1] ?? null;
}

/** The first non-blank value of `name`, as Python's `parse_qsl` (which drops blank values) yields it. */
function firstQueryValue(query: string, name: string): string {
  return new URLSearchParams(query).getAll(name).find((value) => value !== '') ?? '';
}

function youtubeEmbed(id: string | null): string | null {
  return id === null ? null : `https://www.youtube-nocookie.com/embed/${id}`;
}

function vimeoEmbed(id: string | null): string | null {
  return id === null ? null : `https://player.vimeo.com/video/${id}?dnt=1`;
}

const fromYoutube: EmbedReader = (link) => youtubeEmbed(link.path === '/watch'
  ? captured(/^([\w-]{11})$/, firstQueryValue(link.query, 'v'))
  : captured(/^\/(?:embed|shorts)\/([\w-]{11})$/, link.path));

const fromYoutubeShareLink: EmbedReader = (link) => youtubeEmbed(captured(/^\/([\w-]{11})$/, link.path));

const fromYoutubeNocookie: EmbedReader = (link) => youtubeEmbed(captured(/^\/embed\/([\w-]{11})$/, link.path));

const fromVimeo: EmbedReader = (link) => vimeoEmbed(captured(/^\/(\d{1,12})$/, link.path));

const fromVimeoPlayer: EmbedReader = (link) => vimeoEmbed(captured(/^\/video\/(\d{1,12})$/, link.path));

const EMBED_READERS: ReadonlyMap<string, EmbedReader> = new Map([
  ['youtube.com', fromYoutube],
  ['www.youtube.com', fromYoutube],
  ['m.youtube.com', fromYoutube],
  ['youtu.be', fromYoutubeShareLink],
  ['youtube-nocookie.com', fromYoutubeNocookie],
  ['www.youtube-nocookie.com', fromYoutubeNocookie],
  ['vimeo.com', fromVimeo],
  ['www.vimeo.com', fromVimeo],
  ['player.vimeo.com', fromVimeoPlayer],
]);

/** Whether `url` is an acceptable image link. */
export function isHttpsImageUrl(url: string): boolean {
  return parseMediaLink(url) !== null;
}

/** The player URL to embed for a YouTube or Vimeo link; `null` when the link cannot be embedded. */
export function videoEmbedUrl(url: string): string | null {
  const link = parseMediaLink(url);
  if (link === null || link.authority.includes(':')) return null;
  return EMBED_READERS.get(link.authority)?.(link) ?? null;
}
