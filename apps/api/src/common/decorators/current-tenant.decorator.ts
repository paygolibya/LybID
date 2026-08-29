import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import type {
  RequestAuthContext,
  RequestClsStore,
} from '../../database/tenant-context';

export type CurrentTenantInfo = Extract<RequestAuthContext, { mode: 'tenant' }>;

/** Use on routes behind ApiKeyGuard to get the resolved tenant identity. */
export const CurrentTenant = createParamDecorator(
  (_: unknown, _ctx: ExecutionContext): CurrentTenantInfo => {
    const auth = ClsServiceManager.getClsService<RequestClsStore>().get('auth');
    if (!auth || auth.mode !== 'tenant') {
      throw new UnauthorizedException('No tenant auth context on this request');
    }
    return auth;
  },
);
