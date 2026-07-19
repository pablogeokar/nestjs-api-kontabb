export type AllowedUploadType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

const extensionByMime: Record<AllowedUploadType, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

export function sanitizeFileName(fileName: string) {
    return (
        fileName
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/_+/g, '_')
            .slice(0, 160) || 'arquivo'
    );
}

export function extensionForMime(type: AllowedUploadType) {
    return extensionByMime[type];
}

export function isAllowedUploadType(type: string): type is AllowedUploadType {
    return type in extensionByMime;
}

export function hasValidFileSignature(bytes: Uint8Array, type: string): boolean {
    if (type === 'application/pdf') {
        return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    }
    if (type === 'image/jpeg') {
        return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    if (type === 'image/png') {
        const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        return signature.every((value, index) => bytes[index] === value);
    }
    if (type === 'image/webp') {
        return (
            bytes.length >= 12 &&
            bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
        );
    }
    return false;
}
