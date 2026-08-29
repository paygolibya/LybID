import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = await this.jwt.signAsync({
      sub: admin.id,
      email: admin.email,
    });
    return { accessToken };
  }
}
