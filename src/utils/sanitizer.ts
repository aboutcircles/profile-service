import { escape } from 'sqlstring';
import DOMPurify from 'isomorphic-dompurify';
import { IPFSDataProfile, CompleteProfile } from '../types';

export interface ValidationResult<T> {
    isValid: boolean;
    errors: string[];
    sanitized?: T;
}

const DANGEROUS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
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

// Sanitizes a string by removing HTML/JS and SQL injection risks.
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
    
    // Escape SQL special characters
    const sqlSafe = escape(input).slice(1, -1); // Remove the quotes added by escape()
    
    // Sanitize HTML/JS
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

// Strips unknown properties and sanitizes known properties, returning a CompleteProfile.
export function sanitizeProfile(input: any): ValidationResult<CompleteProfile> {
    const errors: string[] = [];
    
    const nameResult = sanitizeString(input.name);
    if (!nameResult.isValid || !nameResult.sanitized) {
        errors.push('Invalid name: ' + nameResult.errors.join(', '));
    }
    
    // Initialize with properties from CompleteProfile; location is included.
    const sanitized: Partial<CompleteProfile> = {
        name: nameResult.sanitized || '',
        description: undefined,
        imageUrl: undefined,
        previewImageUrl: undefined,
        location: undefined,
    };
    
    if (input.description !== undefined && input.description !== '' && input.description !== null) {
        const descResult = sanitizeString(input.description);
        if (!descResult.isValid) {
            errors.push('Invalid description: ' + descResult.errors.join(', '));
        }
        sanitized.description = descResult.sanitized;
    }
    
    if (input.imageUrl !== undefined && input.imageUrl !== '' && input.imageUrl !== null) {
        const urlResult = sanitizeString(input.imageUrl);
        if (!urlResult.isValid || !urlResult.sanitized) {
            errors.push('Invalid imageUrl: ' + urlResult.errors.join(', '));
        }
        sanitized.imageUrl = urlResult.sanitized;
    }
    
    if (input.previewImageUrl !== undefined && input.previewImageUrl !== '' && input.previewImageUrl !== null) {
        const urlResult = sanitizeString(input.previewImageUrl);
        if (!urlResult.isValid || !urlResult.sanitized) {
            errors.push('Invalid previewImageUrl: ' + urlResult.errors.join(', '));
        }
        sanitized.previewImageUrl = urlResult.sanitized;
    }
    
    if (input.location !== undefined && input.location !== '' && input.location !== null) {
        if (typeof input.location !== 'string') {
            errors.push('Location must be a string and cannot exceed 100 characters.');
        } else if (input.location.length > 100) {
            errors.push('Location must be a string and cannot exceed 100 characters.');
        } else {
            const locResult = sanitizeString(input.location);
            if (!locResult.isValid) {
                errors.push('Invalid location: ' + locResult.errors.join(', '));
            }
            sanitized.location = locResult.sanitized;
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        sanitized: errors.length === 0 ? sanitized as CompleteProfile : undefined
    };
}

export function sanitizeSearchParams(params: Record<string, any>): ValidationResult<Record<string, string | undefined>> {
    const sanitized: Record<string, string | undefined> = {};
    const errors: string[] = [];
    
    for (const [key, value] of Object.entries(params)) {
        if (key === 'fetchComplete') {
            // Special handling for boolean parameter
            sanitized[key] = value === 'true' ? 'true' : 'false';
            continue;
        }
        
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
