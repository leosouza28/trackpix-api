import { IntegracoesModel, computeCertificadoStatus } from '../models/integracoes.model';
import { logDev } from '../util';

/**
 * Atualiza o status dos certificados com base na data de expiração.
 * Integrações com certificado expirando em ≤30 dias ficam com status "expirando".
 */
export default async function syncCertificadoExpiry() {
    const integracoes = await IntegracoesModel.find({
        'certificado.expires_at': { $exists: true, $ne: null },
    });

    let updated = 0;
    for (const integracao of integracoes) {
        const expiresAt = integracao.certificado?.expires_at;
        if (!expiresAt) continue;
        const nextStatus = computeCertificadoStatus(expiresAt);
        if (integracao.certificado?.status !== nextStatus) {
            integracao.certificado!.status = nextStatus;
            await integracao.save();
            updated++;
            logDev(`Certificado ${integracao._id}: status → ${nextStatus}`);
        }
    }

    if (updated > 0) {
        console.log(`[cert-expiry] ${updated} integração(ões) atualizada(s)`);
    }
    return { updated };
}
