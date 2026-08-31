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

export type CurrentApplicantInfo = Extract<
  RequestAuthContext,
  { mode: 'applicant' }
>;

/** Use on routes behind ApplicantTokenGuard to get the resolved applicant identity. */
export const CurrentApplicant = createParamDecorator(
  (_: unknown, _ctx: ExecutionContext): CurrentApplicantInfo => {
    const auth = ClsServiceManager.getClsService<RequestClsStore>().get('auth');
    if (!auth || auth.mode !== 'applicant') {
      throw new UnauthorizedException(
        'No applicant auth context on this request',
      );
    }
    return auth;
  },
);
