# AGENTS.md — adelino-api

## Escopo

Estas instruções se aplicam ao diretório `adelino-api/`. O projeto é o backend do Adelino/TrackPIX e usa Node.js, TypeScript, Express 5 e MongoDB via Mongoose.

Antes de editar qualquer arquivo, verifique `git status --short` e preserve alterações locais existentes. Não reverta, sobrescreva ou remova mudanças que não façam parte da tarefa.

## Stack e execução

- Código-fonte: `lib/`.
- Runtime: Node.js; a implantação no App Engine declara `nodejs24` em `app.yaml`.
- Linguagem: TypeScript compilado para CommonJS em `dist/`.
- HTTP principal: Express em `lib/index.ts`.
- Banco: MongoDB; a conexão exige `DB_URL`.
- Sessões: JWT usando `JWT_SECRET`, enviado no header `Authorization: Bearer <token>`.
- Datas e logs de desenvolvimento usam `dayjs` e o locale `pt-br`.

Instale dependências com `npm ci` quando houver `package-lock.json` atualizado. Use `npm install` apenas quando a tarefa realmente alterar dependências.

## Comandos principais

Execute os comandos a partir de `adelino-api/`:

```bash
npm run dev          # API em desenvolvimento, usando lib/index.ts
npm run dev:cron     # worker de sincronização em desenvolvimento
npm run dev:webhook  # servidor HTTPS de webhooks em desenvolvimento
npm run type-check   # validação TypeScript sem gerar arquivos
npm run build        # compila lib/ para dist/ e copia assets necessários
npm start            # inicia dist/index.js
npm run start:vm     # inicia os processos definidos no PM2
```

Não há suíte de testes automatizados configurada no `package.json`. Para mudanças de código, rode pelo menos `npm run type-check`; se a alteração afetar runtime, assets ou o empacotamento, rode também `npm run build`.

O build usa Babel para transformar os arquivos `.ts`/`.tsx` e `copy-files.js` para copiar arquivos estáticos e certificados referenciados pelo runtime. `dist/` é artefato gerado e está no `.gitignore`.

## Variáveis de ambiente

O carregamento local é feito por `dotenv`. O `.env` não deve ser exibido, copiado para commits, incluído em respostas ou enviado a serviços externos.

Variáveis atualmente usadas pelo backend:

- `DB_URL`: conexão obrigatória com o MongoDB.
- `JWT_SECRET`: segredo usado para assinar e decodificar sessões JWT.
- `PORT`: porta da API em produção.
- `DEV=1`: habilita o modo local; nesse modo a API usa `DEV_PORT` e ativa logs de desenvolvimento.
- `DEV_PORT`: porta local da API.
- `CRON_ON=1`: habilita o job periódico do worker.
- `LOG_LEVEL`: nível textual de log do servidor de webhook.
- `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_MEASUREMENT_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_PROJECT_ID` e `FIREBASE_STORAGE_BUCKET`: configuração do Firebase.

Se uma variável nova for necessária, atualize `lib/types/env.d.ts` quando aplicável e documente apenas o nome e a finalidade, nunca o valor.

## Organização do código

- `lib/routes/`: declaração das rotas e composição em `lib/routes/index.ts`.
- `lib/controllers/`: handlers de requisição e regras de aplicação ligadas às rotas.
- `lib/models/`: schemas e modelos Mongoose.
- `lib/oauth/`: criação/decodificação de sessão e middleware `autenticar`.
- `lib/middlewares/`: middlewares compartilhados, incluindo autorização.
- `lib/integrations/`: integrações com bancos, pagamentos, Firebase, e-mail, PDF e impressoras.
- `lib/handlers/`: processamento assíncrono e sincronização de integrações.
- `lib/populations/`: populações/rotinas auxiliares de dados.
- `lib/util/`: utilitários e tratamento de erros/logs.
- `lib/cron-worker.ts`: worker agendado com `node-schedule`; executa sincronização a cada minuto quando `CRON_ON=1`.
- `lib/webhook-server/`: servidor HTTPS separado para webhooks com certificados de cliente.
- `lib/public/` e `lib/assets/`: arquivos estáticos e templates usados pela aplicação.

Ao adicionar uma funcionalidade HTTP, mantenha a separação rota → controller → model/integration. Registre a rota no arquivo de rotas apropriado e, se necessário, em `lib/routes/index.ts`.

## API e autenticação

- `/health` é público e responde `{ ok: true, service: 'trackpix-api' }`.
- Login: `POST /v1/login`.
- A maioria das rotas `/v1/admin/*` exige `autenticar`.
- O contexto da empresa é selecionado pelo header `empresa`; o middleware confirma que o usuário possui acesso e que a empresa está ativa.
- Ao alterar endpoints autenticados, preserve o padrão de `autenticar` e os headers esperados (`Authorization`, `empresa` e, quando necessário, dados de localização).
- Webhooks em `/webhook` e `/webhook/sicoob/pix` têm fluxo próprio e não devem receber autenticação JWT sem uma decisão explícita sobre compatibilidade com os provedores externos.
- Não registre tokens, senhas, chaves privadas, payloads sensíveis ou credenciais em logs. Tenha atenção especial ao middleware de log de bodies em `lib/index.ts` e aos webhooks.

## Integrações e certificados

O diretório `lib/integrations/` contém integrações bancárias e certificados mTLS. Arquivos `.key`, `.pem`, `.p12`, `.pfx` e equivalentes são material sensível, mesmo quando já existem no repositório.

- Não imprimir o conteúdo de certificados ou chaves.
- Não gerar, substituir, converter ou remover certificados sem solicitação explícita.
- Ao alterar o caminho de um certificado, atualize o build/cópia e valide o caminho usado em `dist/`.
- O servidor de webhook usa certificados Let’s Encrypt em `/etc/letsencrypt/live/webhook.trackpix.com.br/` e escuta na porta 443; não tente executá-lo localmente sem uma configuração de certificados adequada.
- Antes de uma mudança em qualquer integração de cobrança, PIX, boleto ou webhook, verifique idempotência, tratamento de erros, ambiente e efeitos sobre dados financeiros.

## Deploy e operações

- `ecosystem.config.js` define os processos PM2 `api-tp` e `cron-tp`.
- `app.yaml` configura o serviço `adelino-api` no Google App Engine.
- `deploy.sh` faz commit/push, conecta por SSH a uma VM, executa `git reset --hard`, instala dependências, compila e reinicia PM2.
- `deploy-gae.sh` compila e executa `gcloud app deploy`.
- `commit.sh` faz commit e push.

Não execute `deploy.sh`, `deploy-gae.sh`, `commit.sh`, `npm run commit` ou `npm run update` como parte de uma tarefa comum. Eles alteram estado remoto, reiniciam serviços ou podem descartar alterações locais. Só execute um desses fluxos quando o usuário pedir explicitamente e depois de confirmar o alvo, branch, projeto e ambiente.

## Boas práticas de alteração

- Prefira alterações pequenas e compatíveis com os padrões existentes.
- Preserve o estilo atual do projeto, inclusive nomes em português e os contratos de resposta já usados pelo frontend.
- Evite alterar modelos Mongoose, rotas financeiras e autenticação sem verificar todos os consumidores.
- Não faça migrações destrutivas, exclusões em massa ou scripts de correção de dados sem confirmação explícita e uma estratégia de rollback/backup.
- Não edite `package-lock.json` manualmente; use o gerenciador de pacotes quando uma mudança de dependência for necessária.
- Ao terminar, confira `git diff --check`, `git status --short` e os comandos de validação relevantes.
