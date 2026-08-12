import { Router } from 'express';
import { autenticar } from '../oauth';
import integracoesController from '../controllers/integracoes.controller';

const router = Router();

router.get('/v1/admin/integracoes/bancos', autenticar, integracoesController.getBancosSchema);
router.get('/v1/admin/integracoes/empresas', autenticar, integracoesController.listEmpresas);
router.get('/v1/admin/integracoes/alertas-certificados', autenticar, integracoesController.alertasCertificados);
router.get('/v1/admin/integracoes', autenticar, integracoesController.list);
router.get('/v1/admin/integracoes/:id', autenticar, integracoesController.getById);
router.post('/v1/admin/integracoes', autenticar, integracoesController.create);
router.put('/v1/admin/integracoes/:id', autenticar, integracoesController.update);
router.post('/v1/admin/integracoes/:id/certificado', autenticar, integracoesController.uploadCertificado);
router.get('/v1/admin/integracoes/:id/certificado/download', autenticar, integracoesController.downloadCertificado);
router.delete('/v1/admin/integracoes/:id/certificado', autenticar, integracoesController.deleteCertificado);
router.post('/v1/admin/integracoes/:id/testar', autenticar, integracoesController.testar);
router.post('/v1/admin/integracoes/:id/resync', autenticar, integracoesController.resync);

export default router;
