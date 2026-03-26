import axios from "axios";
import dayjs from "dayjs";
import fs from 'fs';
import https from 'https';
import path from 'path';
import { IntegracoesModel } from "../../models/integracoes.model";
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

export class BBIntegration {

    development: boolean = false;
    client_id: string = '';
    client_secret: string = '';

    auth_url: string = '';
    url: string = '';

    gwAppKey: string = '';

    auth_url_boletos: string = '';
    url_boletos: string = '';

    httpsAgent: any;
    bearer_token: string = ''
    authorized: boolean = false;
    integracao: IIntegracao = {};
    chave_pix: string = '';


    async init(integracao_id: string) {
        try {
            let integracao: any = await IntegracoesModel.findById(integracao_id);
            if (!integracao) throw new Error('Integração não encontrada');

            let certPath = path.join(__dirname, 'certificates', integracao.path_certificado!, 'cert.pem');
            let keyPath = path.join(__dirname, 'certificates', integracao.path_certificado!, 'key.pem');

            this.client_id = integracao.client_id!;
            this.client_secret = integracao.client_secret!;
            this.gwAppKey = integracao.bbAppKey!;

            this.auth_url = 'https://oauth.bb.com.br/oauth/token';
            this.url = 'https://api-pix.bb.com.br';

            this.httpsAgent = new https.Agent({
                cert: fs.readFileSync(certPath),
                key: fs.readFileSync(keyPath),
                rejectUnauthorized: false
            })
            let need_auth = true
            if (integracao?.bearer_token && integracao?.last_bearer_token_update) {
                // Dura apenas 10 min
                let tokenAge = (Date.now() - integracao.last_bearer_token_update.getTime()) / 1000;
                if (tokenAge < 600) {
                    this.bearer_token = integracao.bearer_token;
                    this.authorized = true;
                    need_auth = false;
                } else {
                    need_auth = true;
                }
            }
            if (need_auth) {
                this.bearer_token = await this.authenticate();
                integracao.bearer_token = this.bearer_token;
                integracao.last_bearer_token_update = new Date();
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
            let basicToken = Buffer.from(`${this.client_id}:${this.client_secret}`).toString('base64');
            const form = new URLSearchParams();
            form.append('grant_type', 'client_credentials');
            form.append('scope', 'cob.write cob.read pix.write pix.read');
            let response = await axios({
                method: "POST",
                url: this.auth_url,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${basicToken}`
                },
                data: form.toString()
            })
            logDev("Resposta da autenticação Pix:", response.data);
            return `${response.data.token_type} ${response.data.access_token}`;
        } catch (error) {
            console.log(error);
            throw error;
        }
    }

    async getRecebimentos(dataInicial: string, dataFinal: string) {
        try {
            if (!this.authorized) throw new Error('Integração não autorizada. Por favor, inicialize a integração primeiro.');
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
                    'gw-dev-app-key': this.gwAppKey
                }).toString();
                let response = await axios({
                    method: "GET",
                    url: `${this.url}/pix/v2/pix?${query}`,
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
                if (error?.response?.data?.detail?.includes("Nenhum resultado encontrado")) {
                    return [];
                }
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
        } catch (error: any) {
            if (error.response.data) {
                console.log("Erro ao consultar Pix recebidos:", JSON.stringify(error.response.data, null, 2));
            }
            throw error
        }
    }
}