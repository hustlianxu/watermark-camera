# 外贸水印相机 · Web/PWA

浏览器优先的外贸水印相机：拍照/导入 → 双语水印 → 记录归档 → Excel/ZIP 导出 → 签名分享。

## 文档

- [需求文档](../docs/product/01-requirements.md)
- [概要设计](../docs/product/02-high-level-design.md)
- [详细设计](../docs/product/03-detailed-design.md)
- [产品与架构总方案](../docs/web-watermark-camera-plan.md)
- [基础设施评估](../docs/infra-aliyun-wireguard-nas-plan.md)

## 当前进度

- [x] 需求、概要设计、详细设计（含专家审计）
- [x] `@wc/core`：模板/布局/Canvas 渲染/Spec 规范化
- [x] `@wc/storage`：LocalDisk / S3(OSS/R2/B2/MinIO) 可配置切换
- [x] 核心单元测试 + 真实 Canvas 渲染测试 + 存储测试
- [x] Web 前端（Vue 3 + PWA）
- [x] API（Fastify + 本地 JSON 存储 + 服务器渲染）
- [x] 记录编辑/重渲、ZIP/Excel 导出、分享
- [x] 文件夹 / 关键词搜索 / 移动照片
- [x] 批量选择 / 多图分享 / 批量删除
- [x] 水印位置/大小/宽度/透明度调节 / 分享有效期
- [x] 字段记忆 / 单图下载
- [x] 弱网/离线暂存 + 自动补传
- [x] 部署到阿里云 + PVE（`cam.tpvlog.top:18443`，CNAME → `www.tpvlog.top`）
- [x] Excel（图片嵌入）+ ZIP 导出
- [x] Excel 自动识别中/西语、可配置白名单、C/D 双语列归一化
- [x] 拍照本地备份 / 远程同步双开关 + 本地备份页 / 系统相册分享
- [x] 离线队列 / 实时水印叠加 / 数字变焦 / 去除水印
- [x] 2GB swap / 持久化存储路径修复 / 管理端口防火墙自启
- [x] 多账号隔离 / 账号级翻译配置 / 后台导出
- [ ] Passkey / OSS 实际启用 / NAS 异地备份

## 常用命令

```bash
npm install --cache .npm-cache
npm test
npx tsc -b packages/core/tsconfig.json
```

> 浏览器基线：Safari iOS 17+（主参考）、Chrome 桌面/Android ≥120（正式支持）；Chrome iOS 为 WebKit best-effort。
