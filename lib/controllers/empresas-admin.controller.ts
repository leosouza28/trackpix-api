import { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import dayjs from 'dayjs';
import crypto from 'crypto';
import { EmpresasModel, MODELO_CLASSIFICACAO_RECEBIMENTO } from '../models/empresas.model';
import { PerfisModel } from '../models/perfis.model';
import { UsuariosModel, USUARIO_MODEL_STATUS, USUARIO_MODEL_TIPO_TELEFONE, USUARIO_NIVEL } from '../models/usuarios.model';
import { IntegracoesModel, BANCOS_SCHEMA, computeCertificadoStatus } from '../models/integracoes.model';
import { LojasModel } from '../models/lojas.model';
import { POSModel } from '../models/pos.model';
import { PixModel } from '../models/pix.model';
import { RecebimentosPixModel } from '../models/recebimentos-pix.model';
import { RecebimentosPOSModel } from '../models/recebimentos-pos.model';
import { RecebimentosBoletosModel } from '../models/recebimentos-boletos.model';
import { errorHandler } from '../util';
import { isScopeAuthorized } from '../oauth/permissions';

function requireEmpresasScope(req: Request, editar = false) {
    const scopes = req.usuario?.scopes || [];
    const needed = editar ? 'empresas.editar' : 'empresas.leitura';
    if (!isScopeAuthorized(needed, scopes) && !scopes.includes('*')) {
        throw Object.assign(new Error('Escopo não autorizado'), { statusCode: 403 });
    }
}

function gerarCodigoAtivacao(tamanho = 8): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(tamanho);
    let code = '';
    for (let i = 0; i < tamanho; i++) {
        code += alphabet[bytes[i] % alphabet.length];
    }
    return code;
}

function limparDocumento(doc?: string) {
    if (!doc) return '';
    return String(doc).replace(/\D/g, '');
}

export default {
    modelosClassificacao: async (_req: Request, res: Response) => {
        try {
            res.json({
                modelos: Object.entries(MODELO_CLASSIFICACAO_RECEBIMENTO).map(([key, label]) => ({ key, label })),
            });
        } catch (error) {
            errorHandler(error, res);
        }
    },

    gerarCodigo: async (req: Request, res: Response) => {
        try {
            requireEmpresasScope(req, true);
            let codigo = gerarCodigoAtivacao();
            let tentativas = 0;
            while (await EmpresasModel.findOne({ codigo_ativacao: codigo }).lean()) {
                codigo = gerarCodigoAtivacao();
                tentativas++;
                if (tentativas > 20) throw new Error('Não foi possível gerar código único');
            }
            res.json({ codigo_ativacao: codigo });
        } catch (error) {
            errorHandler(error, res);
        }
    },

    list: async (req: Request, res: Response) => {
        try {
            requireEmpresasScope(req, false);
            const { busca, active, page = '1', perpage = '20' } = req.query as any;
            const filter: any = {};
            if (active === 'true') filter.active = true;
            if (active === 'false') filter.active = false;
            if (busca) {
                const q = String(busca).trim();
                const docLimpo = limparDocumento(q);
                filter.$or = [
                    { nome: { $regex: q, $options: 'i' } },
                    { nome_fantasia: { $regex: q, $options: 'i' } },
                    { razao_social: { $regex: q, $options: 'i' } },
                    { codigo_ativacao: { $regex: q, $options: 'i' } },
                ];
                if (docLimpo) filter.$or.push({ documento: { $regex: docLimpo } });
            }

            const pageNum = Math.max(1, parseInt(page, 10) || 1);
            const perPageNum = Math.min(100, Math.max(1, parseInt(perpage, 10) || 20));
            const skip = (pageNum - 1) * perPageNum;

            const [lista, total] = await Promise.all([
                EmpresasModel.find(filter).sort({ nome: 1 }).skip(skip).limit(perPageNum).lean(),
                EmpresasModel.countDocuments(filter),
            ]);

            res.json({ lista, total, page: pageNum, perpage: perPageNum });
        } catch (error) {
            errorHandler(error, res);
        }
    },

    getById: async (req: Request, res: Response) => {
        try {
            requireEmpresasScope(req, false);
            const empresa = await EmpresasModel.findById(req.params.id).lean();
            if (!empresa) throw Object.assign(new Error('Empresa não encontrada'), { statusCode: 404 });

            const empresaId = String(empresa._id);
            const filterEmpresa = { 'empresa._id': empresaId };
            const filterUsuarios = { 'empresas._id': empresaId };

            const [
                integracoes,
                usuarios,
                usuariosCount,
                lojasCount,
                posCount,
                perfisCount,
                pixCount,
                recebimentosPixCount,
                recebimentosPosCount,
                recebimentosBoletosCount,
                integracoesAtivasCount,
            ] = await Promise.all([
                IntegracoesModel.find(filterEmpresa, {
                    nome: 1, sku: 1, banco: 1, active: 1, last_sync: 1, certificado: 1,
                }).sort({ nome: 1 }).lean(),
                UsuariosModel.find(filterUsuarios, {
                    nome: 1, username: 1, documento: 1, status: 1, empresas: 1, ultimo_acesso: 1,
                }).sort({ nome: 1 }).limit(50).lean(),
                UsuariosModel.countDocuments(filterUsuarios),
                LojasModel.countDocuments(filterEmpresa),
                POSModel.countDocuments(filterEmpresa),
                PerfisModel.countDocuments(filterEmpresa),
                PixModel.countDocuments(filterEmpresa),
                RecebimentosPixModel.countDocuments(filterEmpresa),
                RecebimentosPOSModel.countDocuments(filterEmpresa),
                RecebimentosBoletosModel.countDocuments(filterEmpresa),
                IntegracoesModel.countDocuments({ ...filterEmpresa, active: true }),
            ]);

            const integracoesResumo = integracoes.map((item: any) => ({
                _id: item._id,
                nome: item.nome,
                sku: item.sku,
                banco: item.banco,
                banco_label: BANCOS_SCHEMA[item.banco]?.label || item.banco,
                active: item.active !== false,
                last_sync: item.last_sync,
                certificado_status: item.certificado?.expires_at
                    ? computeCertificadoStatus(item.certificado.expires_at)
                    : (item.certificado?.status || 'ausente'),
            }));

            const usuariosResumo = usuarios.map((u: any) => {
                const vinculo = (u.empresas || []).find((e: any) => String(e._id) === empresaId);
                return {
                    _id: u._id,
                    nome: u.nome,
                    username: u.username,
                    documento: u.documento,
                    status: u.status,
                    ativo_na_empresa: vinculo?.ativo !== false,
                    perfil: vinculo?.perfil?.nome || null,
                    ultimo_acesso: u.ultimo_acesso,
                };
            });

            res.json({
                ...empresa,
                resumo: {
                    totais: {
                        usuarios: usuariosCount,
                        integracoes: integracoes.length,
                        integracoes_ativas: integracoesAtivasCount,
                        lojas: lojasCount,
                        pos: posCount,
                        perfis: perfisCount,
                        pix_gerados: pixCount,
                        recebimentos_pix: recebimentosPixCount,
                        recebimentos_pos: recebimentosPosCount,
                        recebimentos_boletos: recebimentosBoletosCount,
                    },
                    integracoes: integracoesResumo,
                    usuarios: usuariosResumo,
                },
            });
        } catch (error) {
            errorHandler(error, res);
        }
    },

    create: async (req: Request, res: Response) => {
        try {
            requireEmpresasScope(req, true);
            const body = req.body || {};
            const nome = String(body.nome || '').trim();
            const documento = limparDocumento(body.documento);
            let codigo_ativacao = String(body.codigo_ativacao || '').trim().toUpperCase();

            if (!nome) throw Object.assign(new Error('Nome é obrigatório'), { statusCode: 400 });
            if (!documento) throw Object.assign(new Error('Documento (CNPJ/CPF) é obrigatório'), { statusCode: 400 });

            if (await EmpresasModel.findOne({ documento }).lean()) {
                throw Object.assign(new Error('Já existe empresa com este documento'), { statusCode: 400 });
            }

            if (!codigo_ativacao) {
                codigo_ativacao = gerarCodigoAtivacao();
            }
            if (await EmpresasModel.findOne({ codigo_ativacao }).lean()) {
                throw Object.assign(new Error('Código de ativação já está em uso'), { statusCode: 400 });
            }

            const empresa = await EmpresasModel.create({
                nome,
                nome_fantasia: body.nome_fantasia || nome,
                razao_social: body.razao_social || nome,
                documento,
                doc_type: body.doc_type || (documento.length === 11 ? 'cpf' : 'cnpj'),
                codigo_ativacao,
                email: body.email || '',
                telefones: Array.isArray(body.telefones)
                    ? body.telefones
                    : (body.telefone ? [body.telefone] : []),
                permite_classificacao_recebimentos: !!body.permite_classificacao_recebimentos,
                modelo_classificacao_recebimentos: body.modelo_classificacao_recebimentos || '',
                active: body.active !== false,
            });

            const perfilAdmin = await PerfisModel.create({
                empresa: { _id: String(empresa._id), nome: empresa.nome },
                nome: 'Administrador',
                scopes: ['*'],
                criado_por: {
                    data_hora: dayjs().toDate(),
                    usuario: {
                        _id: String(req.usuario?._id || 'SISTEMA'),
                        nome: req.usuario?.nome || 'SISTEMA',
                    },
                },
            });

            let usuarioCriado: any = null;
            if (body.criar_usuario_admin) {
                const cpf = limparDocumento(body.usuario_documento);
                const username = String(body.usuario_username || '').trim();
                const usuarioNome = String(body.usuario_nome || '').trim();
                const telefone = limparDocumento(body.usuario_telefone);
                const senha = String(body.usuario_senha || 'xpto1234');

                if (!cpf || !username || !usuarioNome) {
                    throw Object.assign(new Error('Para criar usuário admin informe nome, documento e username'), { statusCode: 400 });
                }

                const existente = await UsuariosModel.findOne({
                    $or: [{ documento: cpf }, { username }],
                }).lean();
                if (existente) {
                    throw Object.assign(new Error('Já existe usuário com este documento ou username'), { statusCode: 400 });
                }

                usuarioCriado = await UsuariosModel.create({
                    empresas: [{
                        _id: String(empresa._id),
                        nome: empresa.nome,
                        perfil: { _id: String(perfilAdmin._id), nome: perfilAdmin.nome },
                        ativo: true,
                    }],
                    documento: cpf,
                    username,
                    nome: usuarioNome,
                    doc_type: 'cpf',
                    senha: bcrypt.hashSync(senha, 10),
                    status: USUARIO_MODEL_STATUS.ATIVO,
                    niveis: [USUARIO_NIVEL.ADMIN],
                    origem_cadastro: 'SISTEMA',
                    telefone_principal: telefone ? {
                        tipo: USUARIO_MODEL_TIPO_TELEFONE.CEL_WHATSAPP,
                        valor: telefone,
                    } : undefined,
                    telefones: telefone ? [{
                        tipo: USUARIO_MODEL_TIPO_TELEFONE.CEL_WHATSAPP,
                        valor: telefone,
                        principal: true,
                    }] : [],
                    criado_por: {
                        data_hora: dayjs().toDate(),
                        usuario: {
                            _id: String(req.usuario?._id || 'SISTEMA'),
                            nome: req.usuario?.nome || 'SISTEMA',
                            username: (req.usuario as any)?.username || 'SISTEMA',
                        },
                    },
                });
            }

            // Vincula empresa ao usuário admin global (username admin), se existir
            const adminGlobal = await UsuariosModel.findOne({ username: 'admin' });
            if (adminGlobal) {
                const jaTem = (adminGlobal.empresas || []).some((e: any) => String(e._id) === String(empresa._id));
                if (!jaTem) {
                    await UsuariosModel.updateOne(
                        { _id: adminGlobal._id },
                        {
                            $push: {
                                empresas: {
                                    _id: String(empresa._id),
                                    nome: empresa.nome,
                                    perfil: { _id: String(perfilAdmin._id), nome: perfilAdmin.nome },
                                    ativo: true,
                                },
                            },
                        }
                    );
                }
            }

            res.status(201).json({
                ...empresa.toObject(),
                perfil_admin_id: perfilAdmin._id,
                usuario_admin_id: usuarioCriado?._id || null,
            });
        } catch (error) {
            errorHandler(error, res);
        }
    },

    update: async (req: Request, res: Response) => {
        try {
            requireEmpresasScope(req, true);
            const empresa = await EmpresasModel.findById(req.params.id);
            if (!empresa) throw Object.assign(new Error('Empresa não encontrada'), { statusCode: 404 });

            const body = req.body || {};
            const nomeAnterior = empresa.nome;

            if (body.nome !== undefined) empresa.nome = String(body.nome).trim();
            if (body.nome_fantasia !== undefined) empresa.nome_fantasia = String(body.nome_fantasia).trim();
            if (body.razao_social !== undefined) empresa.razao_social = String(body.razao_social).trim();
            if (body.email !== undefined) empresa.email = String(body.email).trim();
            if (body.doc_type !== undefined) empresa.doc_type = body.doc_type;
            if (body.telefones !== undefined) {
                empresa.telefones = Array.isArray(body.telefones) ? body.telefones : [];
            }
            if (body.telefone !== undefined && !body.telefones) {
                empresa.telefones = body.telefone ? [body.telefone] : [];
            }
            if (body.permite_classificacao_recebimentos !== undefined) {
                empresa.permite_classificacao_recebimentos = !!body.permite_classificacao_recebimentos;
            }
            if (body.modelo_classificacao_recebimentos !== undefined) {
                empresa.modelo_classificacao_recebimentos = body.modelo_classificacao_recebimentos || '';
            }
            if (body.active !== undefined) empresa.active = !!body.active;

            if (body.documento !== undefined) {
                const documento = limparDocumento(body.documento);
                if (!documento) throw Object.assign(new Error('Documento inválido'), { statusCode: 400 });
                const outro = await EmpresasModel.findOne({ documento, _id: { $ne: empresa._id } }).lean();
                if (outro) throw Object.assign(new Error('Já existe empresa com este documento'), { statusCode: 400 });
                empresa.documento = documento;
            }

            if (body.codigo_ativacao !== undefined) {
                const codigo = String(body.codigo_ativacao).trim().toUpperCase();
                if (!codigo) throw Object.assign(new Error('Código de ativação inválido'), { statusCode: 400 });
                const outro = await EmpresasModel.findOne({ codigo_ativacao: codigo, _id: { $ne: empresa._id } }).lean();
                if (outro) throw Object.assign(new Error('Código de ativação já está em uso'), { statusCode: 400 });
                empresa.codigo_ativacao = codigo;
            }

            await empresa.save();

            if (empresa.nome && empresa.nome !== nomeAnterior) {
                await Promise.all([
                    IntegracoesModel.updateMany(
                        { 'empresa._id': String(empresa._id) },
                        { $set: { 'empresa.nome': empresa.nome } }
                    ),
                    PerfisModel.updateMany(
                        { 'empresa._id': String(empresa._id) },
                        { $set: { 'empresa.nome': empresa.nome } }
                    ),
                    UsuariosModel.updateMany(
                        { 'empresas._id': String(empresa._id) },
                        { $set: { 'empresas.$.nome': empresa.nome } }
                    ),
                ]);
            }

            res.json(empresa);
        } catch (error) {
            errorHandler(error, res);
        }
    },
};
