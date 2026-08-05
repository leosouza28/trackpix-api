import 'dotenv/config';
import mongoose from 'mongoose';
import schedule from 'node-schedule';
import syncIntegracoes from './handlers/sync-integracoes';
import syncCertificadoExpiry from './handlers/sync-certificado-expiry';

const packageJson = require('../package.json');
const url = process.env.DB_URL || '';

async function start() {
    console.log(`Cron worker | DB: ${url} | v${packageJson.version}`);
    mongoose.set('maxTimeMS', 120000);
    await mongoose.connect(url);

    mongoose.connection.once('close', () => {
        console.log('Closed connection!');
        process.exit(0);
    });

    const isCronOnline = process.env.CRON_ON === '1';
    console.log({ isCronOnline });

    if (isCronOnline) {
        schedule.scheduleJob('*/1 * * * *', async () => {
            try {
                await syncIntegracoes();
            } catch (error) {
                console.log('Erro ao sincronizar integrações:', error);
            }
        });

        // Diário às 06:00 UTC — atualiza status de validade dos certificados
        schedule.scheduleJob('0 6 * * *', async () => {
            try {
                await syncCertificadoExpiry();
            } catch (error) {
                console.log('Erro ao verificar expiração de certificados:', error);
            }
        });

        console.log('Jobs agendados');
    }
}

start().catch((err) => {
    console.error(err);
    process.exit(1);
});
