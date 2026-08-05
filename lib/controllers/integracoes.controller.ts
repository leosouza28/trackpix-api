import { NextFunction, Request, Response } from 'express';
import {
    BANCOS_SCHEMA,
    INTEGRACOES_BANCOS,
    IntegracoesModel,
    computeCertificadoStatus,
} from '../models/integracoes.model';
import { EmpresasModel } from '../models/empresas.model';
import { errorHandler } from '../util';
import { CertificateService } from '../services/certificate.service';
import { isScopeAuthorized } from '../oauth/permissions';
import { BradescoIntegration } from '../integrations/bradesco';
import { SantanderIntegration } from '../integrations/santander';
import { ItauIntegration } from '../integrations/itau';
import { SicoobIntegration } from '../integrations/sicoob';
import { BBIntegration } from '../integrations/banco-brasil';
import { EfiIntegration } from '../integrations/efi';

const SECRET_FIELDS = [
    'client_secret',
    'client_secret_boletos',
    'access_token',
    'bearer_token',
    'bearer_token_boletos',
    'bearer_token_dev',
];

function maskSecret(value?: string | null) {
    if (!value) return value;
    if (value.length <= 4) return '••••';
    return '••••••••' + value.slice(-4);
}

function sanitizeIntegracao(doc: any, revealSecrets = false) {
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
    if (!revealSecrets) {
        for (const field of SECRET_FIELDS) {
            if (obj[field]) obj[field] = maskSecret(obj[field]);
        }
    }
    if (obj.certificado?.expires_at) {
        obj.certificado.status = computeCertificadoStatus(obj.certificado.expires_at);
    }
    return obj;
}

function uploadedUploadedBy(req: Request) {
    return {
        _id: String(req.usuario?._id || ''),
        nome: req.usuario?.nome || 'Sistema',
    };
}

function getFileBuffer(file: any): Buffer | undefined {
    if (!file) return undefined;
    if (Buffer.isBuffer(file.data)) return file.data;
    if (file.data) return Buffer.from(file.data);
    return undefined;
}

export default {
    getBancosSchema: async (_req: Request, res: Response) => {
        try {
            const bancos = Object.entries(BANCOS_SCHEMA).map(([key, value]) => ({
                key,
                ...value,
            }));
            res.json({ bancos });
        } catch (error) {
            errorHandler(error, res);
        }
    },

    listEmpresas: async (_req: Request, res: Response) => {
        try {
            const empresas = await EmpresasModel.find({}, { nome: 1, nome_fantasia: 1, documento: 1 })
                .sort({ nome: 1 })
                .lean();
            res.json({ lista: empresas });
        } catch (error) {
            errorHandler(error, res);
        }
    },

    /**
     * Certificados expirando (≤30 dias) ou já expirados.
     * Scope * → todas as empresas; demais → apenas empresa ativa.
     */
    alertasCertificados: async (req: Request, res: Response) => {
        try {
            const scopes = req.usuario?.scopes || [];
            const isSuperAdmin = scopes.includes('*');

            if (!isSuperAdmin && !isScopeAuthorized('integracoes.leitura', scopes)) {
                return res.json({ lista: [], total: 0, escopo_global: false });
            }

            const filter: any = {
                active: { $ne: false },
                'certificado.expires_at': { $exists: true, $ne: null },
            };

            if (!isSuperAdmin) {
                filter['empresa._id'] = String(req.empresa?._id);
            }

            const integracoes = await IntegracoesModel.find(filter, {
                nome: 1,
                sku: 1,
                banco: 1,
                empresa: 1,
                certificado: 1,
                active: 1,
            }).lean();

            const lista = integracoes
                .map((item: any) => {
                    const status = computeCertificadoStatus(item.certificado?.expires_at);
                    const expiresAt = item.certificado?.expires_at
                        ? new Date(item.certificado.expires_at)
                        : null;
                    const dias = expiresAt
                        ? Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                        : null;
                    return {
                        _id: item._id,
                        nome: item.nome,
                        sku: item.sku,
                        banco: item.banco,
                        banco_label: BANCOS_SCHEMA[item.banco]?.label || item.banco,
                        empresa: item.empresa,
                        expires_at: item.certificado?.expires_at,
                        uploaded_at: item.certificado?.uploaded_at,
                        subject_cn: item.certificado?.subject_cn,
                        status,
                        dias_restantes: dias,
                    };
                })
                .filter((item) => item.status === 'expirando' || item.status === 'expirado')
                .sort((a, b) => {
                    const da = a.expires_at ? new Date(a.expires_at).getTime() : 0;
                    const db = b.expires_at ? new Date(b.expires_at).getTime() : 0;
                    return da - db;
                });

            res.json({
                lista,
                total: lista.length,
                escopo_global: isSuperAdmin,
            });
        } catch (error) {
            errorHandler(error, res);
        }
    },

    list: async (req: Request, res: Response) => {
        try {
            const { empresa_id, banco, active, busca, page = '1', perpage = '20' } = req.query as any;
            const filter: any = {};
            if (empresa_id) filter['empresa._id'] = String(empresa_id);
            if (banco) filter.banco = String(banco);
            if (active === 'true') filter.active = true;
            if (active === 'false') filter.active = false;
            if (busca) {
                filter.$or = [
                    { nome: { $regex: busca, $options: 'i' } },
                    { sku: { $regex: busca, $options: 'i' } },
                    { 'empresa.nome': { $regex: busca, $options: 'i' } },
                ];
            }

            const pageNum = Math.max(1, parseInt(page, 10) || 1);
            const perPageNum = Math.min(100, Math.max(1, parseInt(perpage, 10) || 20));
            const skip = (pageNum - 1) * perPageNum;

            const [lista, total] = await Promise.all([
                IntegracoesModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(perPageNum).lean(),
                IntegracoesModel.countDocuments(filter),
            ]);

            res.json({
                lista: lista.map((i) => sanitizeIntegracao(i)),
                total,
                page: pageNum,
                perpage: perPageNum,
            });
        } catch (error) {
            errorHandler(error, res);
        }
    },

    getById: async (req: Request, res: Response) => {
        try {
            const integracao = await IntegracoesModel.findById(req.params.id).lean();
            if (!integracao) throw Object.assign(new Error('Integração não encontrada'), { statusCode: 404 });
            res.json(sanitizeIntegracao(integracao));
        } catch (error) {
            errorHandler(error, res);
        }
    },

    create: async (req: Request, res: Response) => {
        try {
            const body = req.body || {};
            if (!body.banco) throw Object.assign(new Error('Banco é obrigatório'), { statusCode: 400 });
            if (!body.empresa?._id && !body.empresa_id) {
                throw Object.assign(new Error('Empresa é obrigatória'), { statusCode: 400 });
            }

            const empresaId = body.empresa?._id || body.empresa_id;
            const empresa = await EmpresasModel.findById(empresaId).lean();
            if (!empresa) throw Object.assign(new Error('Empresa não encontrada'), { statusCode: 400 });

            const schema = BANCOS_SCHEMA[body.banco];
            if (!schema) throw Object.assign(new Error('Banco inválido'), { statusCode: 400 });

            let chaves_itau = body.chaves_itau;
            if (typeof chaves_itau === 'string') {
                chaves_itau = chaves_itau.split(',').map((s: string) => s.trim()).filter(Boolean);
            }

            const doc = await IntegracoesModel.create({
                sku: body.sku || `${body.banco}-${empresa.documento || empresa._id}`.toLowerCase(),
                nome: body.nome || `${schema.label} - ${empresa.nome}`,
                banco: body.banco,
                scopes: body.scopes,
                client_id: body.client_id,
                client_secret: body.client_secret,
                client_id_boletos: body.client_id_boletos,
                client_secret_boletos: body.client_secret_boletos,
                numero_negociacao: body.numero_negociacao,
                cnpj_controle: body.cnpj_controle,
                cnpj_cpfCnpj: body.cnpj_cpfCnpj,
                cnpj_filial: body.cnpj_filial,
                access_token: body.access_token,
                public_key: body.public_key,
                bbAppKey: body.bbAppKey,
                chave_pix: body.chave_pix,
                chave_pix2: body.chave_pix2,
                chaves_itau,
                webhook_url: body.webhook_url,
                active: body.active !== false,
                empresa: {
                    _id: String(empresa._id),
                    nome: empresa.nome,
                },
                certificado: {
                    storage: 'filesystem',
                    status: 'ausente',
                },
            });

            res.status(201).json(sanitizeIntegracao(doc));
        } catch (error) {
            errorHandler(error, res);
        }
    },

    update: async (req: Request, res: Response) => {
        try {
            const integracao = await IntegracoesModel.findById(req.params.id);
            if (!integracao) throw Object.assign(new Error('Integração não encontrada'), { statusCode: 404 });

            const body = req.body || {};
            const updatable = [
                'sku', 'nome', 'scopes', 'client_id', 'client_secret',
                'client_id_boletos', 'client_secret_boletos', 'numero_negociacao',
                'cnpj_controle', 'cnpj_cpfCnpj', 'cnpj_filial',
                'access_token', 'public_key', 'bbAppKey',
                'chave_pix', 'chave_pix2', 'webhook_url', 'active',
            ];

            for (const key of updatable) {
                if (body[key] !== undefined) {
                    // Don't overwrite secrets with masked values
                    if (SECRET_FIELDS.includes(key) && typeof body[key] === 'string' && body[key].includes('••')) {
                        continue;
                    }
                    (integracao as any)[key] = body[key];
                }
            }

            if (body.chaves_itau !== undefined) {
                let chaves = body.chaves_itau;
                if (typeof chaves === 'string') {
                    chaves = chaves.split(',').map((s: string) => s.trim()).filter(Boolean);
                }
                integracao.chaves_itau = chaves;
            }

            if (body.empresa_id || body.empresa?._id) {
                const empresaId = body.empresa_id || body.empresa._id;
                const empresa = await EmpresasModel.findById(empresaId).lean();
                if (!empresa) throw Object.assign(new Error('Empresa não encontrada'), { statusCode: 400 });
                integracao.empresa = { _id: String(empresa._id), nome: empresa.nome };
            }

            await integracao.save();
            res.json(sanitizeIntegracao(integracao));
        } catch (error) {
            errorHandler(error, res);
        }
    },

    uploadCertificado: async (req: Request, res: Response) => {
        try {
            const integracao = await IntegracoesModel.findById(req.params.id);
            if (!integracao) throw Object.assign(new Error('Integração não encontrada'), { statusCode: 404 });
            if (!integracao.empresa?._id) {
                throw Object.assign(new Error('Integração sem empresa vinculada'), { statusCode: 400 });
            }

            const files = req.files || {};
            const pfxFile = (files as any).arquivo || (files as any).pfx || (files as any).certificado;
            const certFile = (files as any).cert || (files as any).certificado_pem;
            const keyFile = (files as any).key || (files as any).chave;

            const pfxBuffer = getFileBuffer(pfxFile);
            const certBuffer = getFileBuffer(certFile);
            const keyBuffer = getFileBuffer(keyFile);

            if (pfxBuffer && pfxBuffer.length > 5 * 1024 * 1024) {
                throw Object.assign(new Error('Arquivo muito grande (máx. 5MB)'), { statusCode: 400 });
            }

            const pfxPassword = req.body?.pfx_password ?? req.body?.senha;
            const filename = pfxFile?.name || certFile?.name || '';

            const extracted = CertificateService.extractFromUpload({
                pfxBuffer,
                pfxPassword,
                certBuffer,
                keyBuffer,
                filename,
            });

            const certificado = await CertificateService.uploadToR2({
                empresaId: String(integracao.empresa._id),
                integracaoId: String(integracao._id),
                extracted,
                uploadedBy: uploadedUploadedBy(req),
            });

            integracao.certificado = certificado as any;
            await integracao.save();

            res.json({
                message: 'Certificado enviado com sucesso',
                certificado: sanitizeIntegracao(integracao).certificado,
            });
        } catch (error) {
            errorHandler(error, res);
        }
    },

    deleteCertificado: async (req: Request, res: Response) => {
        try {
            const integracao = await IntegracoesModel.findById(req.params.id);
            if (!integracao) throw Object.assign(new Error('Integração não encontrada'), { statusCode: 404 });

            await CertificateService.deleteFromR2(
                integracao.certificado?.r2_key_cert || undefined,
                integracao.certificado?.r2_key_key || undefined,
                String(integracao._id),
            );

            integracao.certificado = {
                storage: 'filesystem',
                status: 'ausente',
            } as any;
            await integracao.save();

            res.json({ message: 'Certificado removido com sucesso' });
        } catch (error) {
            errorHandler(error, res);
        }
    },

    testar: async (req: Request, res: Response) => {
        try {
            const integracao = await IntegracoesModel.findById(req.params.id);
            if (!integracao) throw Object.assign(new Error('Integração não encontrada'), { statusCode: 404 });

            const banco = integracao.banco;
            let result: any = { success: 0, error: 'Banco não suportado para teste' };

            if (banco === INTEGRACOES_BANCOS.BRADESCO || banco === INTEGRACOES_BANCOS.BRADESCO_BOLETOS) {
                const scope = banco === INTEGRACOES_BANCOS.BRADESCO_BOLETOS ? 'boletos' : 'pix';
                result = await new BradescoIntegration().init(String(integracao._id), scope);
            } else if (banco === INTEGRACOES_BANCOS.SANTANDER) {
                result = await new SantanderIntegration().init(String(integracao._id));
            } else if (banco === INTEGRACOES_BANCOS.ITAU) {
                result = await new ItauIntegration().init(String(integracao._id));
            } else if (banco === INTEGRACOES_BANCOS.SICOOB) {
                result = await new SicoobIntegration().init(String(integracao._id));
            } else if (banco === INTEGRACOES_BANCOS.BB) {
                result = await new BBIntegration().init(String(integracao._id));
            } else if (banco === INTEGRACOES_BANCOS.EFI) {
                result = await new EfiIntegration().init(String(integracao._id));
            } else if (banco === INTEGRACOES_BANCOS.MERCADO_PAGO_PAYMENTS_POS) {
                if (integracao.access_token) {
                    result = { success: 1, initializated: true, message: 'Access token presente' };
                } else {
                    result = { success: 0, error: 'Access token não configurado' };
                }
            }

            if (result?.success) {
                res.json({ ok: true, message: 'Conexão validada com sucesso', detail: result });
            } else {
                res.status(400).json({ ok: false, message: result?.error || 'Falha ao testar conexão', detail: result });
            }
        } catch (error) {
            errorHandler(error, res);
        }
    },
};
