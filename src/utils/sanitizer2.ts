// File: src/utils/sanitizer2.ts

/**
 * Produces inert-by-default text from untrusted input (often markdown).
 * Preserves (as plain text for a strict renderer later):
 *   - Newlines
 *   - Bold markers: **…**, __…__
 *   - Links:
 *       • Standard: [text](url "title" | 'title' | (title)) → emits titles in ( … )
 *       • Autolinks: <scheme:…> → normalized to [url](url) or "unsafe:"
 *       • Reference link definitions: [id]: url "title" | 'title' | (title) → emits ... (title)
 * Removes all images. Does not render HTML.
 *
 * Output invariants:
 * - &, <, >, " and ' are always escaped (in that order).
 * - All markdown images are removed.
 * - Links allowed only for http/https/mailto or relative; otherwise target becomes "unsafe:".
 * - Titles preserved; always emitted in parentheses with escaping rules for \ and ).
 * - Newlines normalized to \n; tabs → four spaces.
 * - Unicode bidi/invisible and C0/C1 controls (except newline) stripped.
 */

export function sanitizeString2(value: string | number | boolean | null | undefined): string {
    // 3.1 Canonicalization & control stripping
    let s = String(value ?? "");
    s = removeBidiAndInvisibles(s);
    s = removeC0C1ExceptNewline(s);
    s = normalizeLineEndings(s);

    // 3.2 Whitespace normalization
    s = s.replace(/\t/g, "    ");

    // Preserve any leading newline run that immediately follows a leading image.
    // This prevents losing the expected "\n\n" when the input starts with an image and then a ref def line.
    const leadingNlAfterLeadingImage = detectLeadingImageNewlines(s);

    // 3.3 HTML neutralization (pre-escape)
    s = stripHtmlComments(s);
    s = stripDangerousTags(s);
    s = stripDanglingScriptClosers(s);
    s = aggressiveGlobalSchemeNeutralizer(s); // default ON (trade-off documented)

    // 3.4 Remove markdown images (comprehensive)
    s = removeMarkdownImages(s);

    // Re-insert preserved leading newlines after removing a leading image if they went missing.
    if (leadingNlAfterLeadingImage.length > 0 && !s.startsWith(leadingNlAfterLeadingImage)) {
        s = leadingNlAfterLeadingImage + s;
    }

    // 3.5 Sanitize markdown links (before HTML escaping)
    s = sanitizeStandardLinks(s);               // parser-based to handle smuggling & titles
    s = sanitizeAutolinks(s);                   // <scheme:...> → [url](url) or "unsafe:"
    s = sanitizeReferenceLinkDefinitions(s);    // [id]: url "title" → [id]: url (title)

    // 3.8 Final HTML escaping (order matters)
    s = finalHtmlEscape(s);

    return s;
}

/* =====================================================
 * Patterns from §5 (kept close to the spec)
 * ===================================================== */

const TAG_SOURCE =
    /(script|iframe|embed|object|meta|link|style|img|svg|math|template|form|video|audio|source|base|frame|frameset|applet|bgsound)/i;
const DANGEROUS_FULL = new RegExp(String.raw`</?\s*(?:${TAG_SOURCE.source})\b[^>]*>`, "gi");

const INLINE_IMAGE =
    /!\[([^\]\n]{0,1000})\]\(\s*<?([^>\n]{1,2000})>?(?:\s+(?:"([^"]{0,500})|'([^']{0,500})'|\(([^()]{0,500})\)))?\s*\)/g;
const REF_IMAGE_NAMED = /!\[([^\]\n]{0,1000})\]\[([^\]\n]{0,100})\]/g;
const REF_IMAGE_COLLAPSED = /!\[([^\]\n]{0,1000})\]\[\]/g;

// Start detector for standard links; we parse the payload ourselves.
const STANDARD_LINK_START = /\[([^\]\n]{1,1000})\]\(/g;

// Autolinks: broaden pre-colon so entities/percents are handled by normalizer.
const AUTOLINK = /<([a-zA-Z][^>\s]{0,255}[:\uFF1A\u2236][^>\s]{1,2000})>/g;

const REF_LINK_DEF =
    /^\s*\[([^\]]{1,100})\]:\s*(?:<([^>\n]{1,2000})>|([^\s]+))(?:\s+(?:"([^"]{0,500})"|'([^']{0,500})'|\(([^()]{0,500})\)))?\s*$/gm;

const HTML_COMMENTS = /<!--[\s\S]*?-->/g;

const GLOBAL_SCHEME = /((^|[\s"'(>]))(?:javascript|vbscript|data)\s*:/gi;

// Controls per §3.1
const RE_BIDI_INVIS =
    /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u00AD\u2060\uFEFF\u200B-\u200D]/g;
const RE_C0C1_EXCEPT_NL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

const ALLOWLIST_SCHEMES = new Set(["http", "https", "mailto"]);
const ASCII_WS_RE = /[\t\n\r\f ]/g;

const MAX_URL_LEN = 2000;
const MAX_TITLE_LEN = 500;

/* ===============================
 * §3.1 Canonicalization helpers
 * =============================== */

function removeBidiAndInvisibles(input: string): string {
    return input.replace(RE_BIDI_INVIS, "");
}

function removeC0C1ExceptNewline(input: string): string {
    return input.replace(RE_C0C1_EXCEPT_NL, "");
}

function normalizeLineEndings(input: string): string {
    return input.replace(/\r\n?/g, "\n");
}

/* =========================
 * §3.3 HTML neutralization
 * ========================= */

function stripHtmlComments(input: string): string {
    return input.replace(HTML_COMMENTS, "");
}

function stripDangerousTags(input: string): string {
    return input.replace(DANGEROUS_FULL, "");
}

function stripDanglingScriptClosers(input: string): string {
    return input.replace(/<\/\s*script\s*>/gi, "");
}

function aggressiveGlobalSchemeNeutralizer(input: string): string {
    // Rewrites tokens like "javascript:" to "unsafe:" when standing alone or after safe boundaries
    return input.replace(GLOBAL_SCHEME, (_m, p1: string) => `${p1}unsafe:`);
}

/* ==========================
 * §3.4 Remove MD images
 * ========================== */

function removeMarkdownImages(input: string): string {
    return input.replace(INLINE_IMAGE, "").replace(REF_IMAGE_NAMED, "").replace(REF_IMAGE_COLLAPSED, "");
}

/* Preserve leading newlines that follow a leading image */
function detectLeadingImageNewlines(input: string): string {
    // Work after canonicalization so \r\n is already \n
    const rInline = /^(?:!\[[^\]\n]{0,1000}\]\(\s*<?[^>\n]{1,2000}>?(?:\s+(?:"[^"]{0,500}"|'[^']{0,500}'|\([^()]{0,500}\)))?\s*\))(\n+)/;
    const rNamed = /^(?:!\[[^\]\n]{0,1000}\]\[[^\]\n]{0,100}\])(\n+)/;
    const rCollapsed = /^(?:!\[[^\]\n]{0,1000}\]\[\])(\n+)/;

    const m = input.match(rInline) || input.match(rNamed) || input.match(rCollapsed);
    return m ? m[1] : "";
}

/* ==========================================
 * §3.5 Link sanitization (+ §3.6, §3.7)
 * ========================================== */

/**
 * Parse & rewrite standard markdown links using a small single-pass parser,
 * so we can handle whitespace-smuggled schemes (`java\nscript:...`) and titles.
 */
function sanitizeStandardLinks(input: string): string {
    let out = "";
    let last = 0;

    STANDARD_LINK_START.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = STANDARD_LINK_START.exec(input)) !== null) {
        const text = m[1];
        const start = m.index; // at '['
        const afterParen = STANDARD_LINK_START.lastIndex; // just after '('

        const parsed = parseStandardLinkPayload(input, afterParen);
        if (!parsed) {
            // Not a well-formed payload; keep as-is up to after '(' and continue scanning.
            out += input.slice(last, afterParen);
            last = afterParen;
            continue;
        }

        const dest = parsed.dest.slice(0, MAX_URL_LEN);
        const rawTitle = parsed.rawTitle !== undefined ? parsed.rawTitle.slice(0, MAX_TITLE_LEN) : undefined;

        const safeUrl = normalizeAndAllowlistScheme(dest);
        const safeTitle = sanitizeLinkTitle(rawTitle);

        const replacement =
            safeTitle !== undefined
                ? `[${text}](${safeUrl} (${safeTitle}))`
                : `[${text}](${safeUrl})`;

        out += input.slice(last, start) + replacement;
        last = parsed.end; // after closing ')'
        STANDARD_LINK_START.lastIndex = parsed.end;
    }

    out += input.slice(last);
    return out;
}

type ParsedPayload = { dest: string; rawTitle?: string; end: number };

function parseStandardLinkPayload(s: string, i: number): ParsedPayload | null {
    const n = s.length;
    let j = i;

    // Skip leading ASCII whitespace
    while (j < n && isAsciiWsCode(s.charCodeAt(j))) {
        j++;
    }
    if (j >= n) {
        return null;
    }

    // Destination
    let dest = "";
    if (s[j] === "<") {
        // Angle-bracketed destination: read until '>' or newline
        j++;
        const start = j;
        while (j < n && s[j] !== ">" && s[j] !== "\n") {
            j++;
        }
        if (j >= n || s[j] !== ">") {
            return null;
        }
        dest = s.slice(start, j);
        j++; // consume '>'

        // Optional title
        while (j < n && isAsciiWsCode(s.charCodeAt(j))) {
            j++;
        }
        let rawTitle: string | undefined;
        const tParse = parseTitleFrom(s, j);
        if (tParse) {
            rawTitle = tParse.title;
            j = tParse.end;
            while (j < n && isAsciiWsCode(s.charCodeAt(j))) {
                j++;
            }
        }

        if (j < n && s[j] === ")") {
            return { dest, rawTitle, end: j + 1 };
        }
        return null;
    } else {
        // Bare destination: allow ASCII whitespace inside the URL (useful for smuggling),
        // but if whitespace is followed by a title delimiter, split and parse the title.
        const start = j;
        let k = j;
        let parenDepth = 0;

        while (k < n) {
            const ch = s[k];

            if (ch === "(") {
                parenDepth++;
                k++;
                continue;
            }
            if (ch === ")") {
                if (parenDepth > 0) {
                    parenDepth--;
                    k++;
                    continue;
                }
                // End of link without title
                dest = rtrimAsciiWs(s.slice(start, k));
                return { dest, end: k + 1 };
            }

            if (isAsciiWsCode(s.charCodeAt(k)) && parenDepth === 0) {
                // Lookahead past whitespace
                let t = k;
                while (t < n && isAsciiWsCode(s.charCodeAt(t))) {
                    t++;
                }
                const next = s[t];

                if (next === '"' || next === "'" || next === "(") {
                    // Title starts here; dest stops before k
                    dest = rtrimAsciiWs(s.slice(start, k));

                    const tParse = parseTitleFrom(s, t);
                    if (!tParse) {
                        return null;
                    }

                    let u = tParse.end;
                    while (u < n && isAsciiWsCode(s.charCodeAt(u))) {
                        u++;
                    }

                    if (u < n && s[u] === ")") {
                        return { dest, rawTitle: tParse.title, end: u + 1 };
                    }
                    return null;
                }

                // Whitespace *inside* URL; include it (by skipping it here)
                k = t;
                continue;
            }

            k++;
        }

        return null; // no closing ')'
    }
}

function parseTitleFrom(s: string, pos: number): { title: string; end: number } | null {
    const n = s.length;
    if (pos >= n) {
        return null;
    }
    const ch = s[pos];

    if (ch === '"') {
        let j = pos + 1;
        let len = 0;
        while (j < n && s[j] !== '"' && len <= MAX_TITLE_LEN) {
            j++; len++;
        }
        if (j < n && s[j] === '"') {
            return { title: s.slice(pos + 1, j), end: j + 1 };
        }
        return null;
    }

    if (ch === "'") {
        let j = pos + 1;
        let len = 0;
        while (j < n && s[j] !== "'" && len <= MAX_TITLE_LEN) {
            j++; len++;
        }
        if (j < n && s[j] === "'") {
            return { title: s.slice(pos + 1, j), end: j + 1 };
        }
        return null;
    }

    if (ch === "(") {
        let j = pos + 1;
        let len = 0;
        while (j < n && s[j] !== ")" && len <= MAX_TITLE_LEN) {
            j++; len++;
        }
        if (j < n && s[j] === ")") {
            return { title: s.slice(pos + 1, j), end: j + 1 };
        }
        return null;
    }

    return null;
}

function rtrimAsciiWs(str: string): string {
    return str.replace(/[ \t\n\r\f]+$/g, "");
}

function sanitizeAutolinks(input: string): string {
    return input.replace(
        AUTOLINK,
        (match: string, candidate: string, offset: number, whole: string) => {
            // If this <...> is inside a reference definition's prefix, leave it for REF_LINK_DEF.
            if (isWithinRefDefContext(whole, offset)) {
                return match;
            }
            const safeUrl = normalizeAndAllowlistScheme(candidate);
            if (safeUrl === "unsafe:") {
                return "unsafe:";
            }
            return `[${safeUrl}](${safeUrl})`;
        }
    );
}

function isWithinRefDefContext(s: string, idx: number): boolean {
    const lineStart = s.lastIndexOf("\n", idx - 1) + 1;
    const prefix = s.slice(lineStart, idx);
    return /^\s*\[[^\]]{1,100}\]:\s*$/.test(prefix);
}

function sanitizeReferenceLinkDefinitions(input: string): string {
    return input.replace(
        REF_LINK_DEF,
        (
            _m: string,
            id: string,
            angled?: string,
            bare?: string,
            t1?: string,
            t2?: string,
            t3?: string
        ) => {
            const destRaw = (angled && angled.length > 0 ? angled : bare ?? "").slice(0, MAX_URL_LEN);
            const rawTitle = firstDefined(t1, t2, t3);
            const safeUrl = normalizeAndAllowlistScheme(destRaw);
            const safeTitle = sanitizeLinkTitle(rawTitle ?? undefined);

            if (safeTitle !== undefined) {
                return `[${id}]: ${safeUrl} (${safeTitle})`;
            }
            return `[${id}]: ${safeUrl}`;
        }
    );
}

/* ===========================================
 * §3.6 URL scheme normalization & allow-list
 * =========================================== */

function normalizeAndAllowlistScheme(rawUrl: string): string {
    let url = (rawUrl ?? "").trim();

    if (url.startsWith("//")) {
        return "unsafe:"; // protocol-relative is banned
    }

    // Build a normalized buffer up to the first colon (or 256 chars).
    // Ignore ASCII whitespace so "java\nscript:" is detected.
    let norm = "";
    let foundColon = false;

    for (let i = 0; i < url.length && norm.length < 256 && !foundColon; ) {
        const ent = tryDecodeEntity(url, i);
        if (ent) {
            const ch = ent.char;
            if (!isAsciiWsChar(ch)) {
                norm += ch;
            }
            i += ent.consumed;
        } else if (url[i] === "%" && i + 2 < url.length && isHex(url[i + 1]) && isHex(url[i + 2])) {
            const code = parseInt(url.substring(i + 1, i + 3), 16);
            const ch = String.fromCharCode(code);
            if (!isAsciiWsChar(ch)) {
                norm += ch;
            }
            i += 3;
        } else {
            const ch = url[i];
            if (!isAsciiWsChar(ch)) {
                norm += ch;
            }
            i += 1;
        }

        // Map colon-likes to ':'
        const lastCode = norm.charCodeAt(norm.length - 1);
        if (lastCode === 0xff1a /* fullwidth colon */ || lastCode === 0x2236 /* ratio */) {
            norm = norm.slice(0, -1) + ":";
        }

        if (norm.endsWith(":")) {
            foundColon = true;
        }
    }

    // Collapse whitespace around the first colon
    norm = norm.replace(/\s*:\s*/, ":");

    const m = /^([A-Za-z][A-Za-z0-9+\-.]*):/.exec(norm);
    if (m) {
        const scheme = m[1].toLowerCase();
        if (ALLOWLIST_SCHEMES.has(scheme)) {
            // Return original url but stabilize ASCII whitespace as %20
            return url.replace(ASCII_WS_RE, "%20");
        }
        return "unsafe:";
    }

    // No scheme → treat as relative; stabilize ASCII whitespace
    return url.replace(ASCII_WS_RE, "%20");
}

function isHex(ch: string): boolean {
    const c = ch.charCodeAt(0);
    return (
        (c >= 48 && c <= 57) || // 0-9
        (c >= 65 && c <= 70) || // A-F
        (c >= 97 && c <= 102)   // a-f
    );
}

function isAsciiWsCode(code: number): boolean {
    return code === 9 || code === 10 || code === 13 || code === 12 || code === 32; // \t \n \r \f space
}

function isAsciiWsChar(ch: string): boolean {
    return ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === " ";
}

function tryDecodeEntity(
    s: string,
    i: number
): { char: string; consumed: number } | null {
    if (s[i] !== "&") {
        return null;
    }

    // Fast-path common entities
    if (s.startsWith("&amp;", i)) {
        return { char: "&", consumed: 5 };
    }
    if (s.startsWith("&colon;", i)) {
        return { char: ":", consumed: 7 };
    }

    // Numeric decimal: &#NNN;
    const dec = /^&#([0-9]{1,7});/.exec(s.slice(i));
    if (dec) {
        const code = Number.parseInt(dec[1], 10);
        if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
            return { char: String.fromCodePoint(code), consumed: dec[0].length };
        }
    }

    // Numeric hex: &#xHH;
    const hex = /^&#x([0-9A-Fa-f]{1,6});/.exec(s.slice(i));
    if (hex) {
        const code = Number.parseInt(hex[1], 16);
        if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
            return { char: String.fromCodePoint(code), consumed: hex[0].length };
        }
    }

    return null;
}

/* ==========================
 * §3.7 Link title sanitize
 * ========================== */

function sanitizeLinkTitle(rawTitle?: string): string | undefined {
    if (rawTitle == null) {
        return undefined;
    }

    // Remove controls (same as §3.1)
    let t = removeBidiAndInvisibles(rawTitle);
    t = removeC0C1ExceptNewline(t);

    // Replace CR/LF/TAB with a single space
    t = t.replace(/[\r\n\t]+/g, " ");

    // Trim and cap to 200 chars (MAX_TITLE_LEN guards reads)
    t = t.trim();
    if (t.length === 0) {
        return undefined;
    }
    if (t.length > 200) {
        t = t.slice(0, 200);
    }

    // Escape backslash and closing parenthesis, since we emit as ( ... )
    t = t.replace(/\\/g, "\\\\").replace(/\)/g, "\\)");

    return t;
}

/* ==========================
 * §3.8 Final HTML escaping
 * ========================== */

function finalHtmlEscape(input: string): string {
    // Order must be: &, <, >, ", '
    return input
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

/* ==========================
 * Utilities
 * ========================== */

function firstDefined<T>(...xs: (T | undefined)[]): T | undefined {
    for (const x of xs) {
        if (x !== undefined) {
            return x;
        }
    }
    return undefined;
}

export default sanitizeString2;
