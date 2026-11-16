import { Router, type Request } from 'express';

import { asyncHandler } from '../../http/async-handler';
import { authContext, requireAuth } from '../../middleware/auth';
import { requirePermission, resolveWorkspace, workspaceContext } from '../../middleware/workspace';
import {
  createCategorySchema,
  createExpenseSchema,
  listExpensesSchema,
  reviewExpenseSchema,
  updateExpenseSchema,
} from './schemas';
import {
  createCategory,
  createExpense,
  deleteExpense,
  getExpense,
  listCategories,
  listExpenses,
  reviewExpense,
  updateExpense,
} from './service';

export const expenseRouter: Router = Router();

function metaOf(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
}

expenseRouter.use(requireAuth, resolveWorkspace);

expenseRouter.get(
  '/categories',
  requirePermission('expenses:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    res.status(200).json(await listCategories(id));
  }),
);

expenseRouter.post(
  '/categories',
  requirePermission('expenses:write'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = createCategorySchema.parse(req.body);
    res.status(201).json({ category: await createCategory(id, userId, email, input, metaOf(req)) });
  }),
);

expenseRouter.get(
  '/',
  requirePermission('expenses:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    res.status(200).json(await listExpenses(id, listExpensesSchema.parse(req.query)));
  }),
);

expenseRouter.post(
  '/',
  requirePermission('expenses:write'),
  asyncHandler(async (req, res) => {
    const { id, role, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = createExpenseSchema.parse(req.body);
    res
      .status(201)
      .json({ expense: await createExpense(id, role, userId, email, input, metaOf(req)) });
  }),
);

expenseRouter.get(
  '/:expenseId',
  requirePermission('expenses:read'),
  asyncHandler(async (req, res) => {
    const { id } = workspaceContext(req);
    res.status(200).json({ expense: await getExpense(id, param(req, 'expenseId')) });
  }),
);

expenseRouter.patch(
  '/:expenseId',
  requirePermission('expenses:write'),
  asyncHandler(async (req, res) => {
    const { id, role, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = updateExpenseSchema.parse(req.body);
    const expense = await updateExpense(
      id,
      role,
      userId,
      email,
      param(req, 'expenseId'),
      input,
      metaOf(req),
    );
    res.status(200).json({ expense });
  }),
);

expenseRouter.post(
  '/:expenseId/review',
  requirePermission('expenses:approve'),
  asyncHandler(async (req, res) => {
    const { id, userId } = workspaceContext(req);
    const { email } = authContext(req);
    const input = reviewExpenseSchema.parse(req.body);
    const expense = await reviewExpense(
      id,
      userId,
      email,
      param(req, 'expenseId'),
      input,
      metaOf(req),
    );
    res.status(200).json({ expense });
  }),
);

expenseRouter.delete(
  '/:expenseId',
  requirePermission('expenses:write'),
  asyncHandler(async (req, res) => {
    const { id, role, userId } = workspaceContext(req);
    const { email } = authContext(req);
    await deleteExpense(id, role, userId, email, param(req, 'expenseId'), metaOf(req));
    res.status(204).end();
  }),
);
