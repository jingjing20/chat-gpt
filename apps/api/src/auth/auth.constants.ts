/** 集中定义认证 Cookie 名称以及守卫读取的路由元数据键。 */

export const ACCESS_COOKIE = 'chat_access';
export const REFRESH_COOKIE = 'chat_refresh';
export const CSRF_COOKIE = 'chat_csrf';

export const IS_PUBLIC_KEY = 'isPublic';
export const SKIP_CSRF_KEY = 'skipCsrf';
export const AUTH_RATE_LIMIT_KEY = 'authRateLimit';
export const AUTH_CONTROL_REDIS = Symbol('AUTH_CONTROL_REDIS');
