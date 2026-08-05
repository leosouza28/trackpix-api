import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

function getClient() {
    const endpoint = process.env.R2_ENDPOINT
        || (process.env.R2_ACCOUNT_ID
            ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
            : undefined);

    if (!endpoint || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        throw new Error('Credenciais R2 não configuradas (R2_ENDPOINT/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
    }

    return new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });
}

function getBucket() {
    const bucket = process.env.R2_BUCKET_NAME;
    if (!bucket) throw new Error('R2_BUCKET_NAME não configurado');
    return bucket;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

export const R2StorageService = {
    buildCertificateKey(empresaId: string, integracaoId: string, tipo: 'cert' | 'key') {
        return `trackpix-certificates/${empresaId}/${tipo}-${integracaoId}.pem`;
    },

    async upload(key: string, buffer: Buffer, contentType = 'application/x-pem-file') {
        const client = getClient();
        await client.send(new PutObjectCommand({
            Bucket: getBucket(),
            Key: key,
            Body: buffer,
            ContentType: contentType,
        }));
        return key;
    },

    async download(key: string): Promise<Buffer> {
        const client = getClient();
        const response = await client.send(new GetObjectCommand({
            Bucket: getBucket(),
            Key: key,
        }));
        if (!response.Body) throw new Error(`Arquivo não encontrado no R2: ${key}`);
        return streamToBuffer(response.Body as Readable);
    },

    async delete(key: string) {
        const client = getClient();
        await client.send(new DeleteObjectCommand({
            Bucket: getBucket(),
            Key: key,
        }));
    },
};
