/** 扩展 Express 请求类型，声明认证用户与请求追踪上下文。 */

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      auth?: {
        userId: string;
      };
    }
  }
}

export {};
