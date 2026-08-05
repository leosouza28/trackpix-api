/**
 * One-time migration: copy filesystem certificates to Cloudflare R2
 * and update integracoes.certificado metadata.
 *
 * Usage:
 *   npx ts-node -r dotenv/config lib/scripts/migrate-certificates-to-r2.ts
 *
 * Requires R2_* env vars configured.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import forge from 'node-forge';
import crypto from 'crypto';
import { IntegracoesModel, computeCertificadoStatus } from '../models/integracoes.model';
import { R2StorageService } from '../services/r2-storage.service';

const BANK_FOLDER: Record<string, string> = {
    BRADESCO: 'bradesco',
    BRADESCO_BOLETOS: 'bradesco',
    SANTANDER: 'santander',
    ITAU: 'itau',
    SICOOB: 'sicoob',
    BANCO_BRASIL: 'banco-brasil',
    EFI: 'efi',
};

function findCertFiles(banco: string, pathCertificado: string): { cert?: Buffer; key?: Buffer; p12?: Buffer } {
    const folder = BANK_FOLDER[banco] || banco.toLowerCase();
    const base = path.join(__dirname, '..', 'integrations', folder, 'certificates', pathCertificado);

    const certCandidates = ['cert.pem', 'cert.crt'];
    const keyCandidates = ['key.pem', 'key.key'];

    let cert: Buffer | undefined;
    let key: Buffer | undefined;

    for (const name of certCandidates) {
        const p = path.join(base, name);
        if (fs.existsSync(p)) {
            cert = fs.readFileSync(p);
            break;
        }
    }
    for (const name of keyCandidates) {
        const p = path.join(base, name);
        if (fs.existsSync(p)) {
            key = fs.readFileSync(p);
            break;
        }
    }

    const p12Path = path.join(base, 'cert.p12');
    if (fs.existsSync(p12Path)) {
        return { p12: fs.readFileSync(p12Path), cert, key };
    }

    return { cert, key };
}

function metadataFromCertPem(certPem: string) {
    const cert = forge.pki.certificateFromPem(certPem);
    const cn = cert.subject.getField('CN');
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const fingerprint = crypto.createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');
    return {
        expiresAt: cert.validity.notAfter,
        subjectCn: cn?.value || '',
        fingerprint,
    };
}

function extractP12ToPem(p12Buffer: Buffer, password = ''): { certPem: string; keyPem: string } {
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBagsPlain = p12.getBags({ bagType: forge.pki.oids.keyBag });
    const certBag = certBags[forge.pki.oids.certBag]?.[0];
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]
        || keyBagsPlain[forge.pki.oids.keyBag]?.[0];
    if (!certBag?.cert || !keyBag?.key) {
        throw new Error('Não foi possível extrair cert/key do P12 (senha pode ser necessária)');
    }
    return {
        certPem: forge.pki.certificateToPem(certBag.cert),
        keyPem: forge.pki.privateKeyToPem(keyBag.key),
    };
}

async function main() {
    const url = process.env.DB_URL;
    if (!url) throw new Error('DB_URL não configurado');
    await mongoose.connect(url);

    const integracoes = await IntegracoesModel.find({
        path_certificado: { $exists: true, $ne: null },
        'empresa._id': { $exists: true },
    });

    console.log(`Encontradas ${integracoes.length} integrações com path_certificado`);

    let ok = 0;
    let skip = 0;
    let fail = 0;

    for (const integracao of integracoes) {
        const id = String(integracao._id);
        const empresaId = integracao.empresa?._id;
        if (!empresaId || !integracao.path_certificado) {
            skip++;
            continue;
        }

        if (integracao.certificado?.storage === 'r2' && integracao.certificado?.r2_key_cert) {
            console.log(`[SKIP] ${id} já migrada para R2`);
            skip++;
            continue;
        }

        try {
            const files = findCertFiles(integracao.banco!, integracao.path_certificado);
            let certPem: string;
            let keyPem: string;

            if (files.cert && files.key) {
                certPem = files.cert.toString('utf8');
                keyPem = files.key.toString('utf8');
            } else if (files.p12) {
                const extracted = extractP12ToPem(files.p12, process.env.MIGRATE_PFX_PASSWORD || '');
                certPem = extracted.certPem;
                keyPem = extracted.keyPem;
            } else {
                console.log(`[FAIL] ${id} arquivos não encontrados (${integracao.banco}/${integracao.path_certificado})`);
                fail++;
                continue;
            }

            const meta = metadataFromCertPem(certPem);
            const r2KeyCert = R2StorageService.buildCertificateKey(String(empresaId), id, 'cert');
            const r2KeyKey = R2StorageService.buildCertificateKey(String(empresaId), id, 'key');

            await R2StorageService.upload(r2KeyCert, Buffer.from(certPem, 'utf8'));
            await R2StorageService.upload(r2KeyKey, Buffer.from(keyPem, 'utf8'));

            integracao.certificado = {
                storage: 'r2',
                r2_key_cert: r2KeyCert,
                r2_key_key: r2KeyKey,
                uploaded_at: new Date(),
                uploaded_by: { _id: 'migration', nome: 'migrate-certificates-to-r2' },
                expires_at: meta.expiresAt,
                subject_cn: meta.subjectCn,
                fingerprint: meta.fingerprint,
                status: computeCertificadoStatus(meta.expiresAt),
                formato_original: files.p12 && !files.cert ? 'pfx' : 'pem',
                pfx_requer_senha: false,
            } as any;

            await integracao.save();
            console.log(`[OK] ${id} → ${r2KeyCert}`);
            ok++;
        } catch (err: any) {
            console.log(`[FAIL] ${id}: ${err?.message || err}`);
            fail++;
        }
    }

    console.log({ ok, skip, fail });
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
