import sanitizeString2 from "../src/utils/sanitizer2";
import {sanitizeProfile, sanitizeUrl} from "../src/utils/sanitizer";

const S = (x: any) => sanitizeString2(x);

describe("Sanitizer Spec", () => {
    describe("Schemes & smuggling", () => {
        test("basic javascript scheme blocked", () => {
            expect(S(`[x](javascript:1)`)).toBe(`[x](unsafe:)`);
        });

        test("percent-decoded javascript blocked; title normalized to (…)", () => {
            expect(S(`[x](java%73cript:1 "t")`)).toBe(`[x](unsafe: (t))`);
        });

        test("entity-decoded javascript blocked; title normalized", () => {
            expect(S(`[x](j&#x61;vascript:1 "t")`)).toBe(`[x](unsafe: (t))`);
        });

        test("newline-smuggled scheme blocked; title normalized", () => {
            const input = `[x](java
script:1 "t")`;
            expect(S(input)).toBe(`[x](unsafe: (t))`);
        });

        test("many entities pushing to colon are blocked", () => {
            const many =
                `[x](` +
                `&#x006a;&#x0061;&#x0076;&#x0061;&#x0073;&#x0063;&#x0072;&#x0069;&#x0070;&#x0074;&#x003a;` +
                `1)`;
            expect(S(many)).toBe(`[x](unsafe:)`);
        });

        test("autolink with smuggled javascript becomes plain unsafe:", () => {
            expect(S(`<j&#97;va%73cript:1>`)).toBe(`unsafe:`);
        });

        test("reference link def with smuggled javascript blocked", () => {
            expect(S(`[id]: j&#97;vascript:1 "t"`)).toBe(`[id]: unsafe: (t)`);
        });

        test("html-entity colon in scheme blocked", () => {
            expect(S(`[x](javascript&colon;1)`)).toBe(`[x](unsafe:)`);
        });

        test("fullwidth colon autolink blocked", () => {
            expect(S(`<javascript\uFF1A1>`)).toBe(`unsafe:`);
        });
    });

    describe("Protocol-relative & relative", () => {
        test("protocol-relative is unsafe", () => {
            expect(S(`[x](//evil.test)`)).toBe(`[x](unsafe:)`);
        });

        test("relative allowed", () => {
            expect(S(`[rel](/ok)`)).toBe(`[rel](/ok)`);
        });
    });

    describe("Titles (3 forms → emit in parentheses)", () => {
        test("double-quoted becomes (…)", () => {
            expect(S(`[t](https://e "hello")`)).toBe(`[t](https://e (hello))`);
        });

        test("single-quoted becomes (…)", () => {
            expect(S(`[t](https://e 'hi')`)).toBe(`[t](https://e (hi))`);
        });

        test("parenthesized stays parenthesized", () => {
            expect(S(`[t](https://e (yo))`)).toBe(`[t](https://e (yo))`);
        });

        test("escapes backslash and ) inside titles", () => {
            expect(S(`[t](https://e "(he)l\\o")`)).toBe(`[t](https://e ((he\\)l\\\\o))`);
        });
    });

    describe("Angle-bracketed destinations", () => {
        test("angle-bracket URL with space stabilized to %20", () => {
            expect(S(`[x](<https://e?q=a b> "t")`)).toBe(`[x](https://e?q=a%20b (t))`);
        });
    });

    describe("Autolinks normalized", () => {
        test("safe autolink becomes [url](url)", () => {
            expect(S(`<https://e>`)).toBe(`[https://e](https://e)`);
        });

        test("unsafe autolink becomes plain unsafe:", () => {
            expect(S(`<javascript:1>`)).toBe(`unsafe:`);
        });
    });

    describe("Images removed", () => {
        test("inline image removed", () => {
            expect(S(`![a](https://ex/x.png)`)).toBe(``);
        });

        test("reference image removed; definition kept", () => {
            const input = `![a][img]\n\n[img]: https://ex/x.png "t"`;
            const out = S(input);
            expect(out).toBe(`[img]: https://ex/x.png (t)`);
        });
    });

    describe("Raw HTML / dangerous tags", () => {
        test("<script> content preserved, tags removed; final escape applied", () => {
            expect(S(`<script>x</script>`)).toBe(`x`);
        });

        test("other tags become inert text (escaped)", () => {
            // <div ...> should be escaped to plain text
            expect(S(`<div onclick="alert(1)"></div>`)).toBe(`&lt;div onclick=&quot;alert(1)&quot;&gt;&lt;/div&gt;`);
        });
    });

    describe("Global scheme neutralizer trade-off", () => {
        test('may rewrite "JavaScript: ..." to "unsafe: ..." in plain text', () => {
            const out = S(`JavaScript: The Good Parts`);
            expect(out.startsWith(`unsafe:`)).toBe(true);
        });
    });

    describe("Controls / tabs", () => {
        test("comments removed", () => {
            expect(S(`Hello <!-- <script> --> world`)).toBe(`Hello  world`);
        });

        test("tabs → four spaces", () => {
            expect(S(`A\tB`)).toBe(`A    B`);
        });

        test("C0/C1 controls stripped (except newline)", () => {
            expect(S(`A\x00B`)).toBe(`AB`);
        });
    });

    describe("sanitizeUrl — regression tests for entity handling & safe output", () => {
        test("javascript scheme with html-entity colon is unsafe", () => {
            // Fails on the buggy tryDecodeEntity (treats any '&' as &amp;), passes after fix
            expect(sanitizeUrl("javascript&colon;alert(1)")).toBe("unsafe:");
        });

        test("http scheme with html-entity colon is allowed (not rewritten to unsafe)", () => {
            // We allow http/https when the scheme is recognized via &colon; normalization.
            // Output returns original (spaces stabilized), so entity remains.
            const input = "http&colon;//example.com/path";
            expect(sanitizeUrl(input)).toBe(input);
        });

        test("plain ampersands in query strings are preserved", () => {
            const input = "https://example.com/?a=1&b=2";
            expect(sanitizeUrl(input)).toBe(input);
        });

        test("protocol-relative URLs are unsafe", () => {
            expect(sanitizeUrl("//evil.example.com/x")).toBe("unsafe:");
        });

        test("whitespace in URL is stabilized to %20 (allowed scheme)", () => {
            const input = "https://e xa mple.com/a b";
            const output = "https://e%20xa%20mple.com/a%20b";
            expect(sanitizeUrl(input)).toBe(output);
        });
    });

    describe("sanitizeProfile — image fields should not depend on location presence", () => {
        test("keeps previewImageUrl and imageUrl even when location is missing", () => {
            const input = {
                name: "Alice",
                // no location
                previewImageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
                imageUrl: "https://example.com/img.png",
            };

            const out = sanitizeProfile(input);

            expect(out.name).toBe("Alice");
            expect(out.location).toBeUndefined(); // still no location
            // Both image fields should be present and sanitized individually
            expect(out.previewImageUrl).toBe(input.previewImageUrl);
            expect(out.imageUrl).toBe(input.imageUrl);
        });

        test("invalid data URL is marked unsafe via sanitizeUrl", () => {
            const input = {
                name: "Bob",
                previewImageUrl: "data:image/png;base64,**not_base64**",
                imageUrl: "data:text/plain,hello", // non-image data URL -> unsafe
            };

            const out = sanitizeProfile(input);

            expect(out.previewImageUrl).toBe("unsafe:");
            expect(out.imageUrl).toBe("unsafe:");
        });

        test("geoLocation only accepted when valid tuple of numbers within bounds", () => {
            const good = sanitizeProfile({
                name: "Geo",
                geoLocation: [12.34, 56.78],
            });
            expect(good.geoLocation).toEqual([12.34, 56.78]);

            const bad1 = sanitizeProfile({
                name: "BadGeo",
                geoLocation: [200, 10], // invalid longitude
            });
            expect(bad1.geoLocation).toBeUndefined();

            const bad2 = sanitizeProfile({
                name: "BadGeo2",
                geoLocation: [10, -120], // invalid latitude
            });
            expect(bad2.geoLocation).toBeUndefined();

            const bad3 = sanitizeProfile({
                name: "BadGeo3",
                geoLocation: "not-an-array",
            } as any);
            expect(bad3.geoLocation).toBeUndefined();
        });
    });

    describe("sanitizeUrl function", () => {
        test("allows safe http URL", () => {
            expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
        });

        test("rejects javascript scheme", () => {
            expect(sanitizeUrl("javascript:alert(1)")).toBe("unsafe:");
        });

        test("allows image data URL (base64)", () => {
            const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA";
            expect(sanitizeUrl(dataUrl)).toBe(dataUrl);
        });

        test("filters invalid base64 URL (base64)", () => {
            const dataUrl = "data:image/png;base64,-/fsd_.435#+-w0KGgoAAAAZYXQ*NSUhEUgAAAAUA";
            const sanitized = sanitizeUrl(dataUrl);
            expect(sanitized).toBe("unsafe:");
        });

        test("rejects image data URL without base64", () => {
            const dataUrl = "data:image/png,abcdef";
            expect(sanitizeUrl(dataUrl)).toBe("unsafe:");
        });

        test("rejects non‑image data URL", () => {
            expect(sanitizeUrl("data:text/plain,hello")).toBe("unsafe:");
        });
    });

    describe("Minimal DOM round-trip guard (sanity)", () => {
        test("no img/script/unsafe schemes appear after sanitize", () => {
            const input = `
**bold** and __strong__

<script>alert(1)</script>

![x](https://ex/x.png)
[ok](https://ex.com/p "Some Title")
[bad](javascript:alert(1) "x")
<https://example.com>
<javascript:1>

[ref]: <https://ex.com> (Doc v1)
`;
            const out = S(input);
            expect(out).not.toMatch(/<\s*script/i);
            expect(out).not.toMatch(/<\s*img/i);
            expect(out).not.toMatch(/javascript\s*:/i);
            expect(out).toContain(`[ok](https://ex.com/p (Some Title))`);
            expect(out).toContain(`[bad](unsafe: (x))`);
            expect(out).toContain(`[https://example.com](https://example.com)`);
            expect(out).toContain(`unsafe:`);
            expect(out).toContain(`[ref]: https://ex.com (Doc v1)`);
        });
    });
});
