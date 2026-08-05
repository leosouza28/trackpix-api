import https from 'https';
import fs from 'fs';
import path from 'path';
import { R2StorageService } from './r2-storage.service';

interface CacheEntry {
    agent: https.Agent;
    expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

export function invalidateCertificateCache(integracaoId: string) {
    cache.delete(String(integracaoId));
}

function resolveLegacyPaths(banco: string, pathCertificado: string): { certPath: string; keyPath: string } {
    const bankFolderMap: Record<string, string> = {
        BRADESCO: 'bradesco',
        BRADESCO_BOLETOS: 'bradesco',
        SANTANDER: 'santander',
        ITAU: 'itau',
        SICOOB: 'sicoob',
        BANCO_BRASIL: 'banco-brasil',
        EFI: 'efi',
    };
    const folder = bankFolderMap[banco] || banco.toLowerCase();
    const base = path.join(__dirname, '..', 'integrations', folder, 'certificates', pathCertificado);

    const candidates: Array<{ cert: string; key: string }> = [
        { cert: 'cert.pem', key: 'key.pem' },
        { cert: 'cert.crt', key: 'key.pem' },
        { cert: 'cert.crt', key: 'key.key' },
        { cert: 'cert.pem', key: 'key.key' },
    ];

    for (const c of candidates) {
        const certPath = path.join(base, c.cert);
        const keyPath = path.join(base, c.key);
        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
            return { certPath, keyPath };
        }
    }

    // EFI legacy p12
    const p12Path = path.join(base, 'cert.p12');
    if (fs.existsSync(p12Path)) {
        return { certPath: p12Path, keyPath: '' };
    }

    throw new Error(`Certificado não encontrado no filesystem: ${base}`);
}

export async function loadHttpsAgent(integracao: any): Promise<https.Agent> {
    const id = String(integracao._id);
    const cached = cache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.agent;
    }

    let agent: https.Agent;

    if (integracao.certificado?.storage === 'r2' && integracao.certificado?.r2_key_cert && integracao.certificado?.r2_key_key) {
        const cert = await R2StorageService.download(integracao.certificado.r2_key_cert);
        const key = await R2StorageService.download(integracao.certificado.r2_key_key);
        agent = new https.Agent({
            cert,
            key,
            rejectUnauthorized: false,
        });
    } else if (integracao.path_certificado) {
        const { certPath, keyPath } = resolveLegacyPaths(integracao.banco, integracao.path_certificado);
        if (certPath.endsWith('.p12') || certPath.endsWith('.pfx')) {
            agent = new https.Agent({
                pfx: fs.readFileSync(certPath),
                rejectUnauthorized: false,
            });
        } else {
            agent = new https.Agent({
                cert: fs.readFileSync(certPath),
                key: fs.readFileSync(keyPath),
                rejectUnauthorized: false,
            });
        }
    } else {
        throw new Error('Certificado não configurado para esta integração');
    }

    cache.set(id, { agent, expiresAt: Date.now() + CACHE_TTL_MS });
    return agent;
}
