# tcp-forward

一个最小可用的 TCP 转发服务。

- 固定监听 TCP 端口 `7777`
- 管理页面默认监听 `127.0.0.1:3000`
- 前端页面里一行填写一个转发目标，格式为 `host:port`
- 收到的消息会转发到所有目标
- 客户端回包走第一行目标

## 目录

- `index.js`：服务入口
- `public/`：前端管理页面
- `index.test.js`：回归测试
- `ecosystem.config.js`：PM2 配置

## 运行要求

不需要 `node_modules`，因为项目只用了 Node 内置模块。

可用环境变量：

- `ADMIN_HOST`：管理页面监听地址，默认 `127.0.0.1`
- `ADMIN_PORT`：管理页面端口，默认 `3000`
- `LISTEN_HOST`：TCP 服务监听地址，默认 `0.0.0.0`
- `TARGET_HOST`：首次启动时默认目标主机，默认 `127.0.0.1`
- `TARGET_PORT`：首次启动时默认目标端口，默认 `8080`
- `CONFIG_PATH`：配置文件路径，默认 `./forwarder-config.json`
- `CONNECT_TIMEOUT_MS`：连接超时毫秒数，默认 `10000`

注意：

- TCP 转发端口固定是 `7777`
- `ADMIN_PORT` 只影响管理页面，不影响 TCP 转发端口

## 启动

### 用 Node

```bash
node index.js
```

### 用 Bun

```bash
bun index.js
```

### 改管理页端口

```bash
ADMIN_PORT=3001 node index.js
```

或：

```bash
ADMIN_PORT=3001 bun index.js
```

## PM2

项目自带 `ecosystem.config.js`。

启动：

```bash
pm2 start ecosystem.config.js
```

重启并更新环境变量：

```bash
pm2 restart tcp-forward --update-env
```

如果要改管理页端口，修改 `ecosystem.config.js` 里的：

```js
ADMIN_PORT: "3000"
```

如果要用 Bun 跑 PM2，把：

```js
interpreter: "node"
```

改成：

```js
interpreter: "bun"
```

## 使用

1. 启动服务
2. 打开管理页面，例如 `http://127.0.0.1:3000`
3. 在“转发目标”文本框里一行填一个地址
4. 点击“保存”

示例：

```text
127.0.0.1:9001
127.0.0.1:9002
```

这表示：

- 服务监听 `7777`
- 收到的数据同时转发到 `127.0.0.1:9001` 和 `127.0.0.1:9002`
- 返回给客户端的数据来自第一行目标 `127.0.0.1:9001`

## 测试

运行测试：

```bash
npm test
```

或：

```bash
node --test index.test.js
```

## 配置文件

保存后的目标地址会写入配置文件，默认是：

```text
./forwarder-config.json
```

格式如下：

```json
{
  "targets": [
    "127.0.0.1:9001",
    "127.0.0.1:9002"
  ]
}
```
