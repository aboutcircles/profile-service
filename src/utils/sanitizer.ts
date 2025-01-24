import { escape } from 'sqlstring';
import DOMPurify from 'isomorphic-dompurify';

export interface SanitizedProfile {
    name: string;
    description?: string;
    imageUrl?: string;
    previewImageUrl?: string;
}

// Sanitizes a string by removing HTML/JS and SQL injection risks
export function sanitizeString(input: string | null | undefined): string {
    if (!input) return '';
    
    // escape SQL special characters
    const sqlSafe = escape(input).slice(1, -1); // remove the quotes added by escape()
    
    // sanitize HTML/JS
    return DOMPurify.sanitize(sqlSafe, {
        ALLOWED_TAGS: [], // Strip all HTML tags
        ALLOWED_ATTR: [], // Strip all attributes
    });
}

// strips unknown properties and sanitizes known properties
export function sanitizeProfile(input: any): SanitizedProfile {
    const sanitized: SanitizedProfile = {
        name: sanitizeString(input.name),
    };

    if (input.description !== undefined) {
        sanitized.description = sanitizeString(input.description);
    }

    if (input.imageUrl !== undefined) {
        sanitized.imageUrl = sanitizeString(input.imageUrl);
    }

    if (input.previewImageUrl !== undefined) {
        sanitized.previewImageUrl = sanitizeString(input.previewImageUrl);
    }

    return sanitized;
}

export function sanitizeSearchParams(params: Record<string, any>): Record<string, string | undefined> {
    const sanitized: Record<string, string | undefined> = {};
    
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            sanitized[key] = sanitizeString(value.toString());
        } else {
            sanitized[key] = undefined;
        }
    }
    
    return sanitized;
}
