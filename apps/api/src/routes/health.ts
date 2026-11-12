import { Router } from 'express';

export const healthRouter: Router = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    data: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
    },
  });
});
