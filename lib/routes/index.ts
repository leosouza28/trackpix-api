import { Router } from 'express';
import usuariosRoutes from './usuarios.routes';
import comumRoutes from './comum.routes';
import cronsRoutes from './crons.routes';
import webhookRoutes from './webhook.routes';
import relatoriosRoutes from './relatorios.routes';
import recebimentosRoutes from './recebimentos.routes';
import integracoesRoutes from './integracoes.routes';
import empresasRoutes from './empresas.routes';

const router = Router();

router.use(comumRoutes);
router.use(usuariosRoutes);
router.use(cronsRoutes);
router.use(webhookRoutes);
router.use(relatoriosRoutes);
router.use(recebimentosRoutes);
router.use(integracoesRoutes);
router.use(empresasRoutes);

export default router;