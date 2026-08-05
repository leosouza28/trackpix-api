import { Router } from 'express';
import { autenticar } from '../oauth';
import empresasAdminController from '../controllers/empresas-admin.controller';

const router = Router();

router.get('/v1/admin/empresas/modelos-classificacao', autenticar, empresasAdminController.modelosClassificacao);
router.get('/v1/admin/empresas/gerar-codigo', autenticar, empresasAdminController.gerarCodigo);
router.get('/v1/admin/empresas', autenticar, empresasAdminController.list);
router.get('/v1/admin/empresas/:id', autenticar, empresasAdminController.getById);
router.post('/v1/admin/empresas', autenticar, empresasAdminController.create);
router.put('/v1/admin/empresas/:id', autenticar, empresasAdminController.update);

export default router;
