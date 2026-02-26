# common 模块目录规范

- `pages/`：通用基础页面（所有用户可见、所有构建可见），如登录页与首页。
- `services/`：通用基础页面使用的服务层入口；优先在这里聚合，再由页面消费。

## 当前页面

- `pages/login-page.tsx`
- `pages/home-page.tsx`

## 当前服务

- `services/backend-api.ts`
- `services/index.ts`
