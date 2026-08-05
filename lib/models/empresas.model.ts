import mongoose from "mongoose";

const ModelSchema = new mongoose.Schema({
    nome: String,
    nome_fantasia: String,
    razao_social: String,
    documento: String,
    doc_type: { type: String, default: 'cnpj' },

    codigo_ativacao: String,

    email: String,
    telefones: [String],

    permite_classificacao_recebimentos: Boolean,
    modelo_classificacao_recebimentos: String,

    active: { type: Boolean, default: true },
}, {
    timestamps: {
        createdAt: 'createdAt',
        updatedAt: 'updatedAt'
    }
});

export const EmpresasModel = mongoose.model("empresas", ModelSchema);

export const MODELO_CLASSIFICACAO_RECEBIMENTO = {
    'PEDRO_ADELINO': 'PEDRO ADELINO',
};
