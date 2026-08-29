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

export type CurrentAdminInfo = Extract<RequestAuthContext, { mode: 'admin' }>;

/** Use on routes behind AdminJwtGuard to get the authenticated platform admin's id. */
export const CurrentAdmin = createParamDecorator(
  (_: unknown, _ctx: ExecutionContext): CurrentAdminInfo => {
    const auth = ClsServiceManager.getClsService<RequestClsStore>().get('auth');
    if (!auth || auth.mode !== 'admin') {
      throw new UnauthorizedException('No admin auth context on this request');
    }
    return auth;
  },
);
