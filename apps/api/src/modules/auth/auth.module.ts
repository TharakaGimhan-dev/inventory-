import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';
import { Plan } from '../billing/models/plan.model';
import { Membership } from '../tenant/models/membership.model';
import { Tenant } from '../tenant/models/tenant.model';
import { User } from '../user/models/user.model';
import { AuthController } from './controller/auth.controller';
import { AuthService } from './service/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    SequelizeModule.forFeature([User, Tenant, Membership, Plan]),
    PassportModule,
    // Secrets are passed per-sign call instead, because access and refresh use
    // different ones and a module-level default would make it easy to sign a
    // refresh token with the access secret by omission.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
