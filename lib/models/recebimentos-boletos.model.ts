import mongoose from "mongoose";

const ModelSchema = new mongoose.Schema({
    nosso_numero: String,
    especie_documento: String,

    data_emissao: Date,
    data_vencimento: Date,
    valor_bruto: Number,
    valor_juros: Number,
    valor_desconto: Number,
    valor_liquido: Number,
     

    data_pagamento: Date,
    status: String,

    mensagem1: String,
    mensagem2: String,
    mensagem3: String,

    sync_state: {
        type: String,
        default: "SYNC_OPENED"
    },
    
    gateway: String,
    pagador: {
        nome: String,
        cpfCnpj: String
    },

    loja: {
        _id: String,
        nome: String
    },

    empresa: {
        _id: String,
        nome: String,
    }

}, {
    timestamps: {
        createdAt: 'createdAt',
        updatedAt: 'updatedAt'
    }
});

export const RecebimentosBoletosModel = mongoose.model("recebimentos-boletos", ModelSchema);

export const GATEWAY_BOLETO = {
    BRADESCO: "BRADESCO",
};

export const RECEBIMENTO_BOLETO_SYNC_STATE = {
    SYNC_OPENED: "SYNC_OPENED",
    SYNC_DONE: "SYNC_DONE",
}

export const BOLETO_RECEBIMENTO_STATUS = {
    "LIQUIDADO": "LIQUIDADO",
    "PENDENTE": "PENDENTE",
    "ATRASADO": "ATRASADO",
    "VENCIDO": "VENCIDO",
    "BAIXADO": "BAIXADO",
}