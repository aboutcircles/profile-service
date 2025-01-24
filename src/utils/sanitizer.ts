import { escape } from 'sqlstring';
import DOMPurify from 'isomorphic-dompurify';

export interface SanitizedProfile {
    name: string;
    description?: string;
    imageUrl?: string;
    previewImageUrl?: string;
}

export interface ValidationResult<T> {
    isValid: boolean;
    errors: string[];
    sanitized?: T;
}

const URL_PATTERN = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;
const DANGEROUS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /data:/gi,
    /vbscript:/gi,
    /onclick/gi,
    /onload/gi,
    /onerror/gi,
    /onmouseover/gi,
    /eval\(/gi,
    /expression\(/gi
];

function containsDangerousContent(input: string): boolean {
    return DANGEROUS_PATTERNS.some(pattern => pattern.test(input));
}

function isValidUrl(url: string): boolean {
    return URL_PATTERN.test(url);
}

// sanitizes a string by removing HTML/JS and SQL injection risks
export function sanitizeString(input: string | null | undefined): ValidationResult<string> {
    if (!input) {
        return { isValid: true, errors: [], sanitized: '' };
    }

    if (containsDangerousContent(input)) {
        return {
            isValid: false,
            errors: ['Input contains potentially dangerous content'],
        };
    }
    
    // escape SQL special characters
    const sqlSafe = escape(input).slice(1, -1); // remove the quotes added by escape()
    
    // sanitize HTML/JS
    const sanitized = DOMPurify.sanitize(sqlSafe, {
        ALLOWED_TAGS: [], // Strip all HTML tags
        ALLOWED_ATTR: [], // Strip all attributes
        FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'object', 'embed', 'link'],
        FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
    });

    return {
        isValid: true,
        errors: [],
        sanitized
    };
}

// strips unknown properties and sanitizes known properties
export function sanitizeProfile(input: any): ValidationResult<SanitizedProfile> {
    const errors: string[] = [];
    const knownProperties = ['name', 'description', 'imageUrl', 'previewImageUrl'];
    
    const unknownProps = Object.keys(input).filter(key => !knownProperties.includes(key));
    if (unknownProps.length > 0) {
        return {
            isValid: false,
            errors: [`Unknown properties detected: ${unknownProps.join(', ')}`]
        };
    }

    const nameResult = sanitizeString(input.name);
    if (!nameResult.isValid || !nameResult.sanitized) {
        errors.push('Invalid name: ' + nameResult.errors.join(', '));
    }

    const sanitized: SanitizedProfile = {
        name: nameResult.sanitized || '',
    };

    if (input.description !== undefined) {
        const descResult = sanitizeString(input.description);
        if (!descResult.isValid) {
            errors.push('Invalid description: ' + descResult.errors.join(', '));
        }
        sanitized.description = descResult.sanitized;
    }

    if (input.imageUrl !== undefined) {
        const urlResult = sanitizeString(input.imageUrl);
        if (!urlResult.isValid || !urlResult.sanitized || !isValidUrl(urlResult.sanitized)) {
            errors.push('Invalid imageUrl: Must be a valid URL');
        }
        sanitized.imageUrl = urlResult.sanitized;
    }

    if (input.previewImageUrl !== undefined) {
        const urlResult = sanitizeString(input.previewImageUrl);
        if (!urlResult.isValid || !urlResult.sanitized || !isValidUrl(urlResult.sanitized)) {
            errors.push('Invalid previewImageUrl: Must be a valid URL');
        }
        sanitized.previewImageUrl = urlResult.sanitized;
    }

    return {
        isValid: errors.length === 0,
        errors,
        sanitized: errors.length === 0 ? sanitized : undefined
    };
}

export function sanitizeSearchParams(params: Record<string, any>): ValidationResult<Record<string, string | undefined>> {
    const sanitized: Record<string, string | undefined> = {};
    const errors: string[] = [];
    
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            const result = sanitizeString(value.toString());
            if (!result.isValid) {
                errors.push(`Invalid ${key}: ${result.errors.join(', ')}`);
            }
            sanitized[key] = result.sanitized;
        } else {
            sanitized[key] = undefined;
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        sanitized: errors.length === 0 ? sanitized : undefined
    };
}
