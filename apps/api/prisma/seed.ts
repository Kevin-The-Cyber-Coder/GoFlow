/**
 * Development seed.
 *
 * Creates one demo freelancer with a populated workspace so a fresh checkout
 * shows a realistic dashboard. Never run against production data: it assumes
 * the schema is empty enough to create the demo slug.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_SLUG = 'kevin-studio';

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(12, 0, 0, 0);
  return date;
}

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash('Password123!', 12);

  const user = await prisma.user.upsert({
    where: { email: 'demo@goflow.test' },
    update: {},
    create: {
      email: 'demo@goflow.test',
      name: 'Kevin Demo',
      passwordHash,
      currency: 'USD',
      emailVerifiedAt: new Date(),
    },
  });

  const existing = await prisma.workspace.findUnique({ where: { slug: DEMO_SLUG } });
  if (existing !== null) {
    console.log(`Seed already applied for workspace ${DEMO_SLUG}; nothing to do.`);
    return;
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Kevin Studio',
      slug: DEMO_SLUG,
      ownerId: user.id,
      currency: 'USD',
      defaultTaxRateBps: 1500,
      invoicePrefix: 'INV',
      members: { create: { userId: user.id, role: 'OWNER', acceptedAt: new Date() } },
    },
  });

  const [acme, northwind, lumen] = await Promise.all([
    prisma.client.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Acme Technologies',
        company: 'Acme Technologies Ltd',
        email: 'billing@acme.test',
        phone: '+1 555 0100',
        status: 'ACTIVE',
        category: 'Software',
        tags: ['retainer', 'enterprise'],
        billingLine1: '12 Market Street',
        billingCity: 'Austin',
        billingCountry: 'US',
      },
    }),
    prisma.client.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Northwind Design',
        email: 'accounts@northwind.test',
        status: 'ACTIVE',
        category: 'Design',
        tags: ['project'],
      },
    }),
    prisma.client.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Lumen Health',
        email: 'finance@lumen.test',
        status: 'LEAD',
        category: 'Healthcare',
      },
    }),
  ]);

  const [acmeProject, norteProject] = await Promise.all([
    prisma.project.create({
      data: {
        workspaceId: workspace.id,
        clientId: acme.id,
        name: 'Payments platform redesign',
        description: 'Rebuild the checkout flow and reporting screens.',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        startDate: daysFromNow(-40),
        dueDate: daysFromNow(20),
        budgetMinor: 850_000n,
        currency: 'USD',
      },
    }),
    prisma.project.create({
      data: {
        workspaceId: workspace.id,
        clientId: northwind.id,
        name: 'Brand system refresh',
        status: 'PLANNING',
        priority: 'MEDIUM',
        dueDate: daysFromNow(60),
        budgetMinor: 420_000n,
      },
    }),
  ]);

  await prisma.task.createMany({
    data: [
      {
        workspaceId: workspace.id,
        projectId: acmeProject.id,
        title: 'Audit current checkout',
        status: 'DONE',
        position: 0,
        completedAt: daysFromNow(-25),
      },
      {
        workspaceId: workspace.id,
        projectId: acmeProject.id,
        title: 'Invoice dashboard wireframes',
        status: 'IN_PROGRESS',
        position: 1,
        dueDate: daysFromNow(5),
      },
      {
        workspaceId: workspace.id,
        projectId: acmeProject.id,
        title: 'Payment reconciliation report',
        status: 'TODO',
        position: 2,
        dueDate: daysFromNow(12),
      },
      {
        workspaceId: workspace.id,
        projectId: norteProject.id,
        title: 'Moodboard review',
        status: 'TODO',
        position: 0,
        dueDate: daysFromNow(15),
      },
    ],
  });

  const [design, development] = await Promise.all([
    prisma.expenseCategory.create({
      data: { workspaceId: workspace.id, name: 'Software', color: '#6366f1' },
    }),
    prisma.expenseCategory.create({
      data: { workspaceId: workspace.id, name: 'Hosting', color: '#0ea5e9' },
    }),
  ]);

  await prisma.expense.createMany({
    data: [
      {
        workspaceId: workspace.id,
        categoryId: design.id,
        description: 'Design tooling subscription',
        amountMinor: 4_999n,
        date: daysFromNow(-20),
        method: 'CARD',
        createdById: user.id,
      },
      {
        workspaceId: workspace.id,
        categoryId: development.id,
        description: 'Cloud hosting',
        amountMinor: 2_500n,
        date: daysFromNow(-14),
        method: 'CARD',
        createdById: user.id,
        projectId: acmeProject.id,
      },
      {
        workspaceId: workspace.id,
        categoryId: design.id,
        description: 'External monitor',
        amountMinor: 129_900n,
        date: daysFromNow(-8),
        method: 'BANK_TRANSFER',
        createdById: user.id,
      },
    ],
  });

  const paidInvoice = await prisma.invoice.create({
    data: {
      workspaceId: workspace.id,
      clientId: acme.id,
      projectId: acmeProject.id,
      createdById: user.id,
      number: 'INV-0001',
      status: 'PARTIALLY_PAID',
      issueDate: daysFromNow(-30),
      dueDate: daysFromNow(0),
      currency: 'USD',
      subtotalMinor: 450_000n,
      discountMinor: 0n,
      taxMinor: 67_500n,
      totalMinor: 517_500n,
      notes: 'Phase 1 delivery',
      items: {
        create: [
          {
            description: 'Discovery workshops',
            quantityMilli: 2_000,
            unitPriceMinor: 75_000n,
            taxRateBps: 1500,
            totalMinor: 172_500n,
            position: 0,
          },
          {
            description: 'UX design',
            quantityMilli: 40_000,
            unitPriceMinor: 6_000n,
            taxRateBps: 1500,
            totalMinor: 276_000n,
            position: 1,
          },
          {
            description: 'Project management',
            quantityMilli: 1_000,
            unitPriceMinor: 1_500n,
            taxRateBps: 1500,
            totalMinor: 1_725n,
            position: 2,
          },
        ],
      },
    },
  });

  await prisma.payment.create({
    data: {
      workspaceId: workspace.id,
      invoiceId: paidInvoice.id,
      amountMinor: 200_000n,
      method: 'BANK_TRANSFER',
      paidAt: daysFromNow(-10),
      reference: 'TRX-88421',
      recordedById: user.id,
    },
  });

  const settledInvoice = await prisma.invoice.create({
    data: {
      workspaceId: workspace.id,
      clientId: northwind.id,
      projectId: norteProject.id,
      createdById: user.id,
      number: 'INV-0002',
      status: 'PAID',
      issueDate: daysFromNow(-55),
      dueDate: daysFromNow(-40),
      currency: 'USD',
      subtotalMinor: 120_000n,
      taxMinor: 0n,
      totalMinor: 120_000n,
      paidAt: daysFromNow(-42),
      items: {
        create: [
          {
            description: 'Logo exploration',
            quantityMilli: 1_000,
            unitPriceMinor: 120_000n,
            totalMinor: 120_000n,
            position: 0,
          },
        ],
      },
    },
  });

  await prisma.payment.create({
    data: {
      workspaceId: workspace.id,
      invoiceId: settledInvoice.id,
      amountMinor: 120_000n,
      method: 'MOBILE_MONEY',
      paidAt: daysFromNow(-42),
      reference: 'MM-9911',
      recordedById: user.id,
    },
  });

  await prisma.invoice.create({
    data: {
      workspaceId: workspace.id,
      clientId: lumen.id,
      createdById: user.id,
      number: 'INV-0003',
      // Overdue is derived from the due date, not stored: an invoice becomes
      // overdue with the passage of time, so this one is simply still sent.
      status: 'SENT',
      issueDate: daysFromNow(-45),
      dueDate: daysFromNow(-15),
      currency: 'USD',
      subtotalMinor: 80_000n,
      taxMinor: 0n,
      totalMinor: 80_000n,
      items: {
        create: [
          {
            description: 'Technical consultation',
            quantityMilli: 8_000,
            unitPriceMinor: 10_000n,
            totalMinor: 80_000n,
            position: 0,
          },
        ],
      },
    },
  });

  await prisma.notification.create({
    data: {
      userId: user.id,
      workspaceId: workspace.id,
      type: 'INVOICE_OVERDUE',
      title: 'INV-0003 is overdue',
      body: 'Lumen Health has an outstanding balance of $800.00.',
      entityType: 'Invoice',
    },
  });

  console.log('Seed complete. Sign in as demo@goflow.test / Password123!');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
