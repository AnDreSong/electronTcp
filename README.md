# TCP 调试助手

基于 Electron 的跨平台 TCP 调试助手，支持客户端连接、服务端监听、实时收发、UTF-8/ASCII/GBK/Latin-1/十六进制编码、接收数据导出和深浅主题切换。

## 功能

- 客户端模式：连接指定 TCP 服务端。
- 服务端模式：监听本机地址和端口，接受多个 TCP 客户端接入。
- 服务端发送：可广播到所有客户端，也可选择某一个客户端发送。
- 接收显示：服务端模式会标注数据来源客户端。
- 编码：支持 UTF-8、ASCII、GBK、Latin-1、十六进制和 ASCII + 十六进制显示。

## 开发运行

```bash
npm install
npm start
```

## 打包

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

`npm run build` 会使用 `electron-builder` 按当前平台打包。跨平台产物受当前构建系统限制，例如 Windows 安装包通常需要在 Windows 环境或配置 Wine 后构建。
