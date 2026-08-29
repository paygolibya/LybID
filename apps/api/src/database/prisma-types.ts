import { PrismaClient } from '@prisma/client';
import { createTenantScopingExtension } from './prisma-tenant.extension';

// Never invoked — used only so TypeScript can infer the shape of a client
// extended with the tenant-scoping extension, and the transaction-client
// type that shape produces from `$transaction`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildExtendedClient(raw: PrismaClient) {
  return raw.$extends(createTenantScopingExtension(() => undefined));
}

export type ExtendedPrismaClient = ReturnType<typeof buildExtendedClient>;
export type ScopedTransactionClient = Parameters<
  Parameters<ExtendedPrismaClient['$transaction']>[0]
>[0];
