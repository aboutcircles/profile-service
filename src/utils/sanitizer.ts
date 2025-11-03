import {IPFSDataProfile} from '../types';
import sanitizeString2 from "./sanitizer2";

export interface ValidationResult<T> {
    isValid: boolean;
    errors: string[];
    sanitized?: T;
}

// sanitizes a string by removing HTML/JS and SQL injection risks
export function sanitizeString(input: string | null | undefined): string {

    return sanitizeString2(input);
}

export function sanitizeUrl(imageUrl: string | null | undefined): string {
    if (!imageUrl) {
        return "";
    }

    const trimmed = imageUrl.trim();

    // Detect data URLs
    if (/^data:/i.test(trimmed)) {
        const mimeMatch = trimmed.match(/^data:([^;,]+)[;,]/i);
        const mime = mimeMatch ? mimeMatch[1].toLowerCase() : "";
        if (mime.startsWith("image/")) {
            // Ensure the data URL is base64‑encoded
            // The pattern checks for a ';base64,' marker after the MIME type
            // Validate base64 data URL: ensure it contains only valid base64 characters after the comma
            const base64Match = trimmed.match(/^data:image\/[^;]+;base64,([^]*)$/i);
            if (base64Match) {
                const dataPart = base64Match[1];
                // Base64 characters: A-Z, a-z, 0-9, +, /, = (padding)
                if (/^[A-Za-z0-9+/=]+$/.test(dataPart)) {
                    return trimmed;
                }
            }
            return "unsafe:";
        }
        return "unsafe:";
    }

    // Reuse the normaliser from sanitizer2 (copied here to avoid circular import)
    function normalizeAndAllowlistScheme(rawUrl: string): string {
        let url = (rawUrl ?? "").trim();

        if (url.startsWith("//")) {
            return "unsafe:";
        }

        let norm = "";
        let foundColon = false;

        for (let i = 0; i < url.length && norm.length < 256 && !foundColon;) {
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

            const lastCode = norm.charCodeAt(norm.length - 1);
            if (lastCode === 0xff1a || lastCode === 0x2236) {
                norm = norm.slice(0, -1) + ":";
            }

            if (norm.endsWith(":")) {
                foundColon = true;
            }
        }

        norm = norm.replace(/\s*:\s*/, ":");

        const m = /^([A-Za-z][A-Za-z0-9+\-.]*):/.exec(norm);
        if (m) {
            const scheme = m[1].toLowerCase();
            const ALLOWLIST_SCHEMES = new Set(["http", "https", "mailto"]);
            if (ALLOWLIST_SCHEMES.has(scheme)) {
                return url.replace(/[\t\n\r\f ]/g, "%20");
            }
            return "unsafe:";
        }

        return url.replace(/[\t\n\r\f ]/g, "%20");
    }

    function tryDecodeEntity(s: string, i: number): { char: string; consumed: number } | null {
        if (s[i] !== "&") {
            return null;
        }
        // Only match actual &amp; and &colon;, not any '&'
        if (s.startsWith("&amp;", i)) {
            return {char: "&", consumed: 5};
        }
        if (s.startsWith("&colon;", i)) {
            return {char: ":", consumed: 7};
        }
        const dec = /^&#([0-9]{1,7});/.exec(s.slice(i));
        if (dec) {
            const code = Number.parseInt(dec[1], 10);
            if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
                return {char: String.fromCodePoint(code), consumed: dec[0].length};
            }
        }
        const hex = /^&#x([0-9A-Fa-f]{1,6});/.exec(s.slice(i));
        if (hex) {
            const code = Number.parseInt(hex[1], 16);
            if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
                return {char: String.fromCodePoint(code), consumed: hex[0].length};
            }
        }
        return null;
    }

    function isAsciiWsChar(ch: string): boolean {
        return ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === " ";
    }

    function isHex(ch: string): boolean {
        const c = ch.charCodeAt(0);
        return (
            (c >= 48 && c <= 57) ||
            (c >= 65 && c <= 70) ||
            (c >= 97 && c <= 102)
        );
    }

    return normalizeAndAllowlistScheme(trimmed);
}

// strips unknown properties and sanitizes known properties
export function sanitizeProfile(input: any): IPFSDataProfile {
    const sanitized: IPFSDataProfile = {
        name: sanitizeString(input.name) ?? '',
        description: input.description ? sanitizeString(input.description) : undefined,
        location: input.location ? sanitizeString(input.location) : undefined,
        previewImageUrl: input.previewImageUrl ? sanitizeUrl(input.previewImageUrl) : undefined,
        imageUrl: input.imageUrl ? sanitizeUrl(input.imageUrl) : undefined
    };

    // Handle geoLocation ([number, number])
    if (input.geoLocation !== undefined && input.geoLocation !== null) {
        if (Array.isArray(input.geoLocation) && input.geoLocation.length === 2) {
            const [longitude, latitude] = input.geoLocation;
            if (typeof longitude === 'number' && typeof latitude === 'number' &&
                longitude >= -180 && longitude <= 180 &&
                latitude >= -90 && latitude <= 90) {
                sanitized.geoLocation = [longitude, latitude];
            }
        }
    }

    return sanitized;
}

export function sanitizeSearchParams(params: Record<string, any>): ValidationResult<Record<string, string | undefined>> {
    const sanitized: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(params)) {
        if (key === 'fetchComplete') {
            // Boolean handling
            sanitized[key] = value === 'true' ? 'true' : 'false';
            continue;
        }

        if (value !== undefined && value !== null) {
            sanitized[key] = sanitizeString2(value.toString());
        } else {
            sanitized[key] = undefined;
        }
    }

    return {
        isValid: true,
        errors: [],
        sanitized
    };
}
