import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auditLog: AuditLogService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string }> {
    // platform_admin_users is not tenant-scoped, so this read needs no auth
    // context — it's the entry point that produces one.
    const admin = await this.prisma.client.platformAdminUser.findUnique({
      where: { email },
    });
    if (!admin || !(await compare(password, admin.passwordHash))) {
      // Phase 8: the one piece of brute-force-relevant telemetry this
      // system didn't have before — every attempt is recorded, success or
      // failure. Uses the *attempted* email as actorId when no matching
      // admin exists (there's no real actor id to use), same posture as
      // logging any other unauthenticated attempt. AuditLogService.record()
      // works here specifically because there's no request transaction
      // open yet (this route has no guard) and AuditLog has no RLS to
      // bypass — see its own comment.
      await this.auditLog.record({
        actorType: 'platform_admin',
        actorId: admin?.id ?? email,
        action: 'admin.login.failure',
        targetType: 'platform_admin_user',
        targetId: admin?.id ?? email,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.auditLog.record({
      actorType: 'platform_admin',
      actorId: admin.id,
      action: 'admin.login.success',
      targetType: 'platform_admin_user',
      targetId: admin.id,
    });

    const accessToken = await this.jwt.signAsync({
      sub: admin.id,
      email: admin.email,
    });
    return { accessToken };
  }
}
