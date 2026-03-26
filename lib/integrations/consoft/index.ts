import axios from "axios";
import dayjs from "dayjs";

const SERVER = "https://app3.csicorpnet.com.br";


export default class Consoft {
    client_token: string;
    tenant_id: string;

    constructor(client_token: string, tenant_id: string) {
        this.client_token = client_token;
        this.tenant_id = tenant_id;
    }

    async getTitulosCobranca(data = dayjs().format('YYYY-MM-DD')) {
        try {
            let queryParams = new URLSearchParams({ Data: data })
            let endpoint = '/csAPIFinanceiro/rest/CSAPI_Financeiro/Get_TituloByData'
            let headers = {
                "Token": this.client_token,
                "TenantID": this.tenant_id
            }
            let url = `${SERVER}${endpoint}?${queryParams.toString()}`;
            console.log(url);
            let response = await axios({
                method: "GET",
                url,
                headers
            })
            console.log(response.data);
            return response.data;
        } catch (error: any) {
            if (error?.response?.data) {
                console.error("Error response data:", error.response.data);
            }
            throw error;
        }
    }

}