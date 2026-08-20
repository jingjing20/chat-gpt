import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isIP } from 'node:net';

export function isInfrastructureAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.startsWith('::ffff:')
    ? address.slice('::ffff:'.length)
    : address;
  if (normalized === '::1' || normalized === '127.0.0.1') return true;
  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    return (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  }
  return /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(normalized);
}

@Injectable()
export class MetricsNetworkGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (isInfrastructureAddress(request.socket.remoteAddress)) return true;
    throw new ForbiddenException('指标端点只允许基础设施网络访问');
  }
}
