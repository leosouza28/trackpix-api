import axios from "axios";
import { IntegracoesModel } from "../../models/integracoes.model";
import https from 'https';
import path from 'path';
import fs from 'fs'
import dayjs from "dayjs";
import { logDev } from "../../util";


interface IIntegracao {
    _id?: string;
    client_id?: string;
    client_secret?: string;
    path_certificado?: string;
    bearer_token_dev?: string;
    last_bearer_token_update_dev?: Date;
    bearer_token?: string;
    last_bearer_token_update?: Date;
    chave_pix?: string
}

export class BradescoIntegration {

    development: boolean = false;
    client_id: string = '';
    client_secret: string = '';
    // Boletos
    client_id_boletos: string = '';
    client_secret_boletos: string = '';
    numero_negociacao: string = '';
    cnpj_filial: string = '';
    cnpj_cpfCnpj: string = '';
    cnpj_controle: string = '';

    auth_url: string = '';
    url: string = '';

    auth_url_boletos: string = '';
    url_boletos: string = '';

    httpsAgent: any;
    bearer_token: string = ''
    authorized: boolean = false;
    integracao: IIntegracao = {};
    chave_pix: string = '';

    constructor() {
    }

    async init(integracao_id: string, scope: 'pix' | 'boletos' = 'pix') {
        try {
            let integracao: any = await IntegracoesModel.findById(integracao_id);
            if (!integracao) throw new Error('Integração não encontrada');
            this.chave_pix = integracao.chave_pix || '';
            this.integracao = integracao;

            this.client_id = integracao.client_id!;
            this.client_secret = integracao.client_secret!;

            this.client_id_boletos = integracao.client_id_boletos!;
            this.client_secret_boletos = integracao.client_secret_boletos!;

            this.auth_url = 'https://qrpix.bradesco.com.br/auth/server/oauth/token'
            this.url = 'https://qrpix.bradesco.com.br';
            this.auth_url_boletos = 'https://openapi.bradesco.com.br/auth/server-mtls/v2/token'
            this.url_boletos = 'https://openapi.bradesco.com.br';

            if (scope == 'boletos') {
                this.cnpj_controle = integracao.cnpj_controle!;
                this.cnpj_cpfCnpj = integracao.cnpj_cpfCnpj!;
                this.cnpj_filial = integracao.cnpj_filial!;
                this.numero_negociacao = integracao.numero_negociacao!;
            }

            let certPath = path.join(__dirname, 'certificates', integracao.path_certificado!, 'cert.pem');
            let keyPath = path.join(__dirname, 'certificates', integracao.path_certificado!, 'key.pem');
            this.httpsAgent = new https.Agent({
                cert: fs.readFileSync(certPath),
                key: fs.readFileSync(keyPath),
                rejectUnauthorized: false
            })
            let need_auth = true
            if (integracao?.bearer_token && integracao?.last_bearer_token_update && scope == 'pix') {
                // Dura apenas 1 hora
                let tokenAge = (Date.now() - integracao.last_bearer_token_update.getTime()) / 1000;
                if (tokenAge < 3600) {
                    this.bearer_token = integracao.bearer_token;
                    this.authorized = true;
                    need_auth = false;
                } else {
                    need_auth = true;
                }
            }
            if (integracao?.bearer_token_boletos && integracao?.last_bearer_token_boletos_update && scope == 'boletos') {
                // Dura apenas 1 hora
                let tokenAge = (Date.now() - integracao.last_bearer_token_boletos_update.getTime()) / 1000;
                if (tokenAge < 3600) {
                    this.bearer_token = integracao.bearer_token_boletos!;
                    this.authorized = true;
                    need_auth = false;
                } else {
                    need_auth = true;
                }
            }
            if (need_auth && scope == 'pix') {
                this.bearer_token = await this.authenticate();
                integracao.bearer_token = this.bearer_token;
                integracao.last_bearer_token_update = new Date();
                await integracao.save();
                this.authorized = true;
            }
            if (need_auth && scope == 'boletos') {
                this.bearer_token = await this.authenticateBoletos();
                integracao.bearer_token_boletos = this.bearer_token;
                integracao.last_bearer_token_boletos_update = new Date();
                await integracao.save();
                this.authorized = true;
            }
            return { success: 1, initializated: true }
        } catch (error: any) {
            return { success: 0, error: error?.message || "Erro desconhecido" }
        }
    }
    async authenticate() {
        try {
            logDev("Iniciando autenticação Pix...");
            let form = new URLSearchParams();
            form.append('grant_type', 'client_credentials');
            form.append('client_id', this.client_id);
            form.append('client_secret', this.client_secret);
            let response = await axios({
                method: "POST",
                url: this.auth_url,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                httpsAgent: this.httpsAgent,
                data: form.toString()
            })
            logDev("Resposta da autenticação Pix:", response.data);
            return `${response.data.token_type} ${response.data.access_token}`;
        } catch (error) {
            throw error;
        }
    }
    async authenticateBoletos() {
        try {
            logDev("Iniciando autenticação para boletos...");
            let form = new URLSearchParams();
            form.append('grant_type', 'client_credentials');
            form.append('client_id', this.client_id_boletos!);
            form.append('client_secret', this.client_secret_boletos!);

            let response = await axios({
                method: "POST",
                url: this.auth_url_boletos,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                httpsAgent: this.httpsAgent,
                data: form.toString()
            })
            return `${response.data.token_type} ${response.data.access_token}`;
        } catch (error) {
            logDev("Erro na autenticação para boletos:", error);
            throw error;
        }
    }

    async getRecebimentos(dataInicial: string, dataFinal: string) {
        try {
            let paginaAtual = 0;
            let totalPaginas = 1;
            let todosResultados: any[] = [];
            let agora = dayjs().format('YYYY-MM-DD');
            let _dataFinal = '';
            if (agora === dayjs(dataFinal).format('YYYY-MM-DD')) {
                _dataFinal = dayjs().toISOString();
            } else {
                _dataFinal = dayjs(dataFinal).endOf('day').toISOString();
            }
            let _dataInicial = dayjs(dataInicial).toISOString()
            while (paginaAtual < totalPaginas) {
                let query = new URLSearchParams({
                    inicio: _dataInicial,
                    fim: _dataFinal,
                    'paginacao.paginaAtual': paginaAtual.toString(),
                }).toString();
                let response = await axios({
                    method: "GET",
                    url: `${this.url}/v2/pix?${query}`,
                    httpsAgent: this.httpsAgent,
                    headers: {
                        'Accept': 'application/json',
                        'authorization': this.bearer_token
                    }
                })
                let dados = response.data;
                todosResultados = todosResultados.concat(dados.pix);
                totalPaginas = dados.parametros.paginacao.quantidadeDePaginas;
                paginaAtual += 1;
            }
            return todosResultados;
        } catch (error: any) {
            if (error.response.data) {
                console.log("Erro ao consultar Pix recebidos:", JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }

    async setWebhook(url: string = 'https://webhook.trackpix.com.br/webhook') {
        try {
            let response = await axios({
                method: "PUT",
                url: `${this.url}/v2/webhook/${this.chave_pix}`,
                httpsAgent: this.httpsAgent,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'authorization': this.bearer_token
                },
                data: JSON.stringify({
                    webhookUrl: url
                })
            })
            await IntegracoesModel.updateOne(
                {
                    _id: this.integracao._id
                },
                {
                    $set: {
                        webhook_configurado: true,
                        webhook_url: url
                    }
                }
            )
        } catch (error: any) {
            if (error.response.data) {
                console.log("Erro ao consultar Pix recebidos:", JSON.stringify(error.response.data, null, 2));
            }
            throw error
        }
    }
    async getWebhooks() {
        try {
            let response = await axios({
                method: "GET",
                url: `${this.url}/v2/webhook`,
                httpsAgent: this.httpsAgent,
                headers: {
                    'Accept': 'application/json',
                    'authorization': this.bearer_token
                }
            })
            // console.log(JSON.stringify(response.data, null, 2));
        } catch (error: any) {
            if (error.response.data) {
                console.log("Erro ao consultar Pix recebidos:", JSON.stringify(error.response.data, null, 2));
            }
            throw error
        }
    }


    async getBoletosBaixados() {
        try {
            let paginaAtual = 0;
            let todosResultados: any[] = [];
            let fetch = true;
            let statusBaixas: any = {};

            while (fetch) {
                let payload = {
                    "dataVencimentoDe": "0",
                    "dataVencimentoAte": "0",
                    "codigoBaixa": "0",
                    "produto": "9",
                    "negociacao": this.numero_negociacao,
                    "cpfCnpj": {
                        "filial": this.cnpj_filial,
                        "cpfCnpj": this.cnpj_cpfCnpj,
                        "controle": this.cnpj_controle
                    },
                    "valorTituloInicio": "0",
                    "versao": "1",
                    "paginaAnterior": paginaAtual.toString()
                }
                logDev("Buscando boletos baixados - página", paginaAtual);
                let response = await axios({
                    method: "POST",
                    url: `${this.url_boletos}/boleto/cobranca-baixado-consulta/v1/listar`,
                    httpsAgent: this.httpsAgent,
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'authorization': this.bearer_token
                    },
                    data: JSON.stringify(payload)
                })
                let dados = response.data;
                dados.titulos.forEach((boleto: any) => {
                    if (boleto?.statusTitulo && !statusBaixas[boleto.statusTitulo]) {
                        logDev("Status de baixa encontrado:", boleto.statusTitulo);
                        statusBaixas[boleto.statusTitulo] = 0;
                    }
                    statusBaixas[boleto.statusTitulo]++
                })
                todosResultados = todosResultados.concat(dados.titulos);
                if (dados?.indMaisPagina == 'N') fetch = false;
                paginaAtual++;
            }
            // fs.writeFileSync(path.join(__dirname, `boletos_baixados.json`), JSON.stringify(todosResultados, null, 2));
            return todosResultados.length;
        } catch (error) {
            throw error;
        }
    }
    async getBoletosPendentes(data = dayjs().add(-3, 'h').format('YYYY-MM-DD')) {
        try {
            let paginaAtual = 0;
            let todosResultados: any[] = [];
            let fetch = true;
            while (fetch) {
                let payload = {
                    "dataRegistroDe": dayjs(data).format('DDMMYYYY'),
                    "dataRegistroAte": dayjs(data).format('DDMMYYYY'),
                    "dataVencimentoDe": "0",
                    "dataVencimentoAte": "0",
                    "valorTituloDe": "0",
                    "produto": "09",
                    "negociacao": this.numero_negociacao,
                    "faixaVencto": "7",
                    "nossoNumero": "0",
                    "cpfCnpjPagador": {
                        "filial": "0",
                        "cpfCnpj": "0",
                        "controle": "0"
                    },
                    "cpfCnpj": {
                        "filial": this.cnpj_filial,
                        "cpfCnpj": this.cnpj_cpfCnpj,
                        "controle": this.cnpj_controle
                    },
                    "paginaAnterior": paginaAtual.toString()
                }
                let response = await axios({
                    method: "POST",
                    url: `${this.url_boletos}/boleto/cobranca-pendente/v1/listar`,
                    httpsAgent: this.httpsAgent,
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'authorization': this.bearer_token
                    },
                    data: JSON.stringify(payload)
                })
                let dados = response.data;
                todosResultados = todosResultados.concat(dados.titulos);
                if (dados?.indMaisPagina == 'N') fetch = false;
                paginaAtual++;
            }
            await Promise.allSettled(
                todosResultados.map(async (boleto: any) => {
                    if (boleto?.codStatus === 13) {
                        try {
                            boleto.detalhes = await this.getBoletoDetalhes(boleto.nossoNumero);
                            // logDev("Carregado detalhes do boleto pendente", boleto.nossoNumero);
                        } catch (error) {
                            logDev("Erro ao carregar detalhes do boleto pendente", boleto.nossoNumero, error);
                        }
                    }
                })
            )
            // fs.writeFileSync(path.join(__dirname, `boletos_pendentes-${dayjs(data).format("YYYY-MM-DD")}.json`), JSON.stringify(todosResultados, null, 2));
            return todosResultados;
        } catch (error: any) {
            if (error?.response?.data?.status === 412) {
                return [];
            }
            throw error;
        }
    }
    async getBoletosLiquidados(data = dayjs().add(-3, 'h').format('YYYY-MM-DD')) {
        try {
            let todosResultados: any[] = [];
            let fetch = true;
            let paginaAtual = 0;
            while (fetch) {
                let response = await axios({
                    method: "POST",
                    url: `${this.url_boletos}/boleto/cobranca-lista/v1/listar`,
                    httpsAgent: this.httpsAgent,
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'authorization': this.bearer_token
                    },
                    data: JSON.stringify({
                        produto: "9",
                        negociacao: this.numero_negociacao,
                        origemPagamento: "1",
                        valorTituloDe: "0",
                        valorTituloAte: "999999999999",
                        paginaAnterior: paginaAtual.toString(),
                        dataMovimentoDe: "0",
                        dataMovimentoAte: "0",
                        dataPagamentoDe: dayjs(data).format("DDMMYYYY"),
                        dataPagamentoAte: dayjs(data).format("DDMMYYYY"),
                        cpfCnpj: {
                            filial: this.cnpj_filial,
                            controle: this.cnpj_controle,
                            cpfCnpj: this.cnpj_cpfCnpj
                        }
                    })
                })
                todosResultados = todosResultados.concat(response.data.titulos);
                if (response.data?.indMaisPagina == 'N') fetch = false;
                paginaAtual++;
            }
            await Promise.allSettled(
                todosResultados.map(async (boleto: any) => {
                    try {
                        let detalhes = await this.getBoletoDetalhes(boleto.nossoNumero);
                        boleto.detalhes = detalhes;
                    } catch (error) {
                        console.log("Erro ao buscar detalhes do boleto", error);
                    }
                })
            )
            // fs.writeFileSync(__dirname + `/boletos_liquidados-${dayjs(data).format("YYYY-MM-DD")}.json`, JSON.stringify(todosResultados, null, 2));
            return todosResultados;
        } catch (error: any) {
            if (error?.response?.data?.status === 412) {
                return [];
            }
            throw error
        }
    }
    async getBoletoDetalhes(nossoNumero: string) {
        try {
            let response = await axios({
                method: "POST",
                url: `${this.url_boletos}/boleto/cobranca-consulta/v1/consultar`,
                httpsAgent: this.httpsAgent,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'authorization': this.bearer_token
                },
                data: JSON.stringify({
                    "sequencia": "0",
                    "produto": "09",
                    "negociacao": this.numero_negociacao,
                    "nossoNumero": nossoNumero,
                    "cpfCnpj": {
                        "filial": this.cnpj_filial,
                        "cpfCnpj": this.cnpj_cpfCnpj,
                        "controle": this.cnpj_controle
                    },
                    "status": "0"
                })
            })
            return response.data;
        } catch (error: any) {
            if (error?.response?.data) {
                console.log("Erro ao consultar detalhes do boleto:", JSON.stringify(error.response.data, null, 2));
            }
            throw error
        }
    }
}