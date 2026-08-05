import type { ApiEnv } from '@chat/config';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { API_ENV } from '../config/app-config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CsrfGuard } from './csrf.guard';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';
import { SecurityService } from './security.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => ({ secret: env.ACCESS_TOKEN_SECRET }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SecurityService,
    RateLimitService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [SecurityService],
})
export class AuthModule {}
