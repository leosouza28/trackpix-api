import mongoose from "mongoose";

const CertificadoSchema = new mongoose.Schema({
    storage: { type: String, enum: ['r2', 'filesystem'], default: 'filesystem' },
    r2_key_cert: String,
    r2_key_key: String,
    uploaded_at: Date,
    uploaded_by: {
        _id: String,
        nome: String
    },
    expires_at: Date,
    subject_cn: String,
    fingerprint: String,
    status: { type: String, enum: ['valido', 'expirando', 'expirado', 'ausente'], default: 'ausente' },
    formato_original: { type: String, enum: ['pfx', 'pem', 'crt_key'] },
    pfx_requer_senha: Boolean,
}, { _id: false });

const ModelSchema = new mongoose.Schema({
    sku: String,
    nome: String,
    banco: String,

    scopes: String,
    
    client_id: String,
    client_secret: String,

    client_id_boletos: String,
    client_secret_boletos: String,
    numero_negociacao: String,
    cnpj_controle: String,
    cnpj_cpfCnpj: String,
    cnpj_filial: String,

    // MercadoPago
    access_token: String,
    public_key: String,
    // BB
    bbAppKey: String,

    path_certificado: String,
    bearer_token: String,
    last_bearer_token_update: Date,

    bearer_token_boletos: String,
    last_bearer_token_boletos_update: Date,

    path_certificado_dev: String,
    bearer_token_dev: String,
    last_bearer_token_update_dev: Date,

    chave_pix: String,
    chave_pix2: String,
    chaves_itau: [String],

    webhook_configurado: Boolean,
    webhook_url: String,
    
    last_sync: Date,

    active: Boolean,

    certificado: CertificadoSchema,
    
    empresa: {
        _id: String,
        nome: String
    }
}, {
    timestamps: {
        createdAt: 'createdAt',
        updatedAt: 'updatedAt'
    }
});

export const IntegracoesModel = mongoose.model("integracoes", ModelSchema);

export const INTEGRACOES_BANCOS = {
    BRADESCO: 'BRADESCO',
    BB: 'BANCO_BRASIL',
    SICOOB: 'SICOOB',
    ITAU: 'ITAU',
    SANTANDER: 'SANTANDER',
    EFI: 'EFI',
    MERCADO_PAGO_PAYMENTS_POS: 'MERCADO_PAGO_PAYMENTS_POS',
    BRADESCO_BOLETOS: 'BRADESCO_BOLETOS',
}

export const BANCOS_SCHEMA: Record<string, {
    label: string;
    requiresCert: boolean;
    fields: { key: string; label: string; required: boolean; type?: string }[];
}> = {
    [INTEGRACOES_BANCOS.SANTANDER]: {
        label: 'Santander',
        requiresCert: true,
        fields: [
            { key: 'client_id', label: 'Client ID', required: true },
            { key: 'client_secret', label: 'Client Secret', required: true },
            { key: 'chave_pix', label: 'Chave PIX', required: true },
        ]
    },
    [INTEGRACOES_BANCOS.BRADESCO]: {
        label: 'Bradesco PIX',
        requiresCert: true,
        fields: [
            { key: 'client_id', label: 'Client ID', required: true },
            { key: 'client_secret', label: 'Client Secret', required: true },
            { key: 'chave_pix', label: 'Chave PIX', required: true },
        ]
    },
    [INTEGRACOES_BANCOS.BRADESCO_BOLETOS]: {
        label: 'Bradesco Boletos',
        requiresCert: true,
        fields: [
            { key: 'client_id', label: 'Client ID PIX', required: false },
            { key: 'client_secret', label: 'Client Secret PIX', required: false },
            { key: 'client_id_boletos', label: 'Client ID Boletos', required: true },
            { key: 'client_secret_boletos', label: 'Client Secret Boletos', required: true },
            { key: 'numero_negociacao', label: 'Número Negociação', required: true },
            { key: 'cnpj_controle', label: 'CNPJ Controle', required: true },
            { key: 'cnpj_cpfCnpj', label: 'CNPJ/CPF', required: true },
            { key: 'cnpj_filial', label: 'CNPJ Filial', required: true },
            { key: 'chave_pix', label: 'Chave PIX', required: false },
        ]
    },
    [INTEGRACOES_BANCOS.ITAU]: {
        label: 'Itaú',
        requiresCert: true,
        fields: [
            { key: 'client_id', label: 'Client ID', required: true },
            { key: 'client_secret', label: 'Client Secret', required: true },
            { key: 'chave_pix', label: 'Chave PIX', required: true },
            { key: 'chave_pix2', label: 'Chave PIX 2', required: false },
            { key: 'chaves_itau', label: 'Chaves Itaú (separadas por vírgula)', required: false, type: 'array' },
        ]
    },
    [INTEGRACOES_BANCOS.SICOOB]: {
        label: 'Sicoob',
        requiresCert: true,
        fields: [
            { key: 'client_id', label: 'Client ID', required: true },
            { key: 'client_secret', label: 'Client Secret', required: false },
            { key: 'scopes', label: 'Scopes OAuth', required: true },
            { key: 'chave_pix', label: 'Chave PIX', required: true },
        ]
    },
    [INTEGRACOES_BANCOS.BB]: {
        label: 'Banco do Brasil',
        requiresCert: true,
        fields: [
            { key: 'client_id', label: 'Client ID', required: true },
            { key: 'client_secret', label: 'Client Secret', required: true },
            { key: 'bbAppKey', label: 'BB App Key', required: true },
            { key: 'chave_pix', label: 'Chave PIX', required: true },
        ]
    },
    [INTEGRACOES_BANCOS.EFI]: {
        label: 'EFI (Gerencianet)',
        requiresCert: true,
        fields: [
            { key: 'client_id', label: 'Client ID', required: true },
            { key: 'client_secret', label: 'Client Secret', required: true },
            { key: 'chave_pix', label: 'Chave PIX', required: true },
        ]
    },
    [INTEGRACOES_BANCOS.MERCADO_PAGO_PAYMENTS_POS]: {
        label: 'Mercado Pago POS',
        requiresCert: false,
        fields: [
            { key: 'access_token', label: 'Access Token', required: true },
            { key: 'public_key', label: 'Public Key', required: true },
        ]
    },
}

export function computeCertificadoStatus(expiresAt?: Date | null): 'valido' | 'expirando' | 'expirado' | 'ausente' {
    if (!expiresAt) return 'ausente';
    const now = Date.now();
    const exp = new Date(expiresAt).getTime();
    if (exp <= now) return 'expirado';
    const daysLeft = (exp - now) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 30) return 'expirando';
    return 'valido';
}
