import forge from 'node-forge';
import crypto from 'crypto';
import { R2StorageService } from './r2-storage.service';
import { computeCertificadoStatus } from '../models/integracoes.model';
import { invalidateCertificateCache } from './certificate-loader.service';

export interface ExtractedCertificate {
    certPem: string;
    keyPem: string;
    expiresAt: Date;
    subjectCn: string;
    fingerprint: string;
    formatoOriginal: 'pfx' | 'pem' | 'crt_key';
    pfxRequerSenha: boolean;
}

function getSubjectCn(cert: forge.pki.Certificate): string {
    const cn = cert.subject.getField('CN');
    return cn?.value || cert.subject.attributes.map(a => `${a.shortName}=${a.value}`).join(', ');
}

function fingerprintFromPem(certPem: string): string {
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(certPem))).getBytes();
    return crypto.createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');
}

function parseCertMetadata(certPem: string) {
    const cert = forge.pki.certificateFromPem(certPem);
    return {
        expiresAt: cert.validity.notAfter,
        subjectCn: getSubjectCn(cert),
        fingerprint: fingerprintFromPem(certPem),
    };
}

function extractFromPfx(buffer: Buffer, password: string): ExtractedCertificate {
    let p12Asn1: forge.asn1.Asn1;
    try {
        p12Asn1 = forge.asn1.fromDer(buffer.toString('binary'));
    } catch {
        throw Object.assign(new Error('Arquivo corrompido ou formato inválido'), { statusCode: 400 });
    }

    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
        p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password || '');
    } catch {
        throw Object.assign(new Error('Senha do certificado incorreta'), { statusCode: 400 });
    }

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBagsPlain = p12.getBags({ bagType: forge.pki.oids.keyBag });

    const certBag = certBags[forge.pki.oids.certBag]?.[0];
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]
        || keyBagsPlain[forge.pki.oids.keyBag]?.[0];

    if (!certBag?.cert) {
        throw Object.assign(new Error('Certificado não encontrado no arquivo PFX'), { statusCode: 400 });
    }
    if (!keyBag?.key) {
        throw Object.assign(new Error('Chave privada não encontrada no arquivo PFX'), { statusCode: 400 });
    }

    const certPem = forge.pki.certificateToPem(certBag.cert);
    const keyPem = forge.pki.privateKeyToPem(keyBag.key);
    const meta = parseCertMetadata(certPem);

    return {
        certPem,
        keyPem,
        ...meta,
        formatoOriginal: 'pfx',
        pfxRequerSenha: true,
    };
}

function extractFromPemPair(certBuffer: Buffer, keyBuffer: Buffer): ExtractedCertificate {
    let certPem = certBuffer.toString('utf8');
    let keyPem = keyBuffer.toString('utf8');

    if (!certPem.includes('BEGIN CERTIFICATE')) {
        throw Object.assign(new Error('Arquivo de certificado inválido (esperado PEM)'), { statusCode: 400 });
    }
    if (!keyPem.includes('BEGIN') || !keyPem.includes('PRIVATE KEY')) {
        throw Object.assign(new Error('Arquivo de chave privada inválido (esperado PEM)'), { statusCode: 400 });
    }

    try {
        const meta = parseCertMetadata(certPem);
        return {
            certPem,
            keyPem,
            ...meta,
            formatoOriginal: 'crt_key',
            pfxRequerSenha: false,
        };
    } catch {
        throw Object.assign(new Error('Arquivo corrompido ou formato inválido'), { statusCode: 400 });
    }
}

export const CertificateService = {
    extractFromUpload(opts: {
        pfxBuffer?: Buffer;
        pfxPassword?: string;
        certBuffer?: Buffer;
        keyBuffer?: Buffer;
        filename?: string;
    }): ExtractedCertificate {
        const { pfxBuffer, pfxPassword, certBuffer, keyBuffer, filename } = opts;
        const lower = (filename || '').toLowerCase();

        if (pfxBuffer) {
            if ((lower.endsWith('.pfx') || lower.endsWith('.p12')) && pfxPassword === undefined) {
                throw Object.assign(new Error('Senha do certificado é obrigatória para arquivos PFX/P12'), { statusCode: 400 });
            }
            return extractFromPfx(pfxBuffer, pfxPassword || '');
        }

        if (certBuffer && keyBuffer) {
            return extractFromPemPair(certBuffer, keyBuffer);
        }

        throw Object.assign(new Error('Envie um arquivo .pfx/.p12 ou o par certificado + chave'), { statusCode: 400 });
    },

    async uploadToR2(opts: {
        empresaId: string;
        integracaoId: string;
        extracted: ExtractedCertificate;
        uploadedBy: { _id: string; nome: string };
    }) {
        const { empresaId, integracaoId, extracted, uploadedBy } = opts;
        const r2KeyCert = R2StorageService.buildCertificateKey(empresaId, integracaoId, 'cert');
        const r2KeyKey = R2StorageService.buildCertificateKey(empresaId, integracaoId, 'key');

        await R2StorageService.upload(r2KeyCert, Buffer.from(extracted.certPem, 'utf8'));
        await R2StorageService.upload(r2KeyKey, Buffer.from(extracted.keyPem, 'utf8'));

        invalidateCertificateCache(integracaoId);

        return {
            storage: 'r2' as const,
            r2_key_cert: r2KeyCert,
            r2_key_key: r2KeyKey,
            uploaded_at: new Date(),
            uploaded_by: uploadedBy,
            expires_at: extracted.expiresAt,
            subject_cn: extracted.subjectCn,
            fingerprint: extracted.fingerprint,
            status: computeCertificadoStatus(extracted.expiresAt),
            formato_original: extracted.formatoOriginal,
            pfx_requer_senha: extracted.pfxRequerSenha,
        };
    },

    async deleteFromR2(r2KeyCert?: string, r2KeyKey?: string, integracaoId?: string) {
        if (r2KeyCert) {
            try { await R2StorageService.delete(r2KeyCert); } catch { /* ignore missing */ }
        }
        if (r2KeyKey) {
            try { await R2StorageService.delete(r2KeyKey); } catch { /* ignore missing */ }
        }
        if (integracaoId) invalidateCertificateCache(integracaoId);
    },
};
