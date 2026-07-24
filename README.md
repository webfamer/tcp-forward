# tcp-forward

一个最小可用的 TCP 转发服务。

- 固定监听 TCP 端口 `7777`
- 管理页面默认监听 `127.0.0.1:3000`
- 支持 TCP 拆包、粘包和帧头前无效字节恢复
- 按帧头、设备地址和数据类型匹配转发规则
- 每条规则支持一个主目标和多个只读镜像目标
- 默认丢弃所有上游回包

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
3. 点击“新增规则”，选择全部设备或固定设备地址；固定设备支持填写多个十进制地址
4. 选择设备类型，填写主目标与可选镜像目标
5. 选择是否将未匹配报文全量转发到默认目标
6. 点击“保存并应用”

规则内部仍按 `frameType + deviceAddress + dataType` 匹配，但管理页面会把帧头和内部类型字节
合并显示为一个“设备类型”，无需理解协议字段。精确规则优先于 `*` 通配规则。

一个表单规则中的多个设备地址会在保存时展开为多条后端路由，重新加载时再合并为同一张规则卡。

支持的 `frameType`：

- `FUSE`：`4D4D5A5A`
- `HOST`：`444C5A4A`
- `ECCN`：`4543434E`
- `IOTD`：`494F5444`

设备地址使用十进制字符串；`HOST`、`ECCN` 的 `dataType` 使用原始一字节十六进制值，例如
`01`、`02`。

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
  "routes": [
    {
      "frameType": "ECCN",
      "deviceAddress": "1001",
      "dataType": "02",
      "primary": "127.0.0.1:9001",
      "mirrors": ["127.0.0.1:9002"],
      "replyPolicy": "none"
    }
  ],
  "defaultRoute": {
    "frameType": "*",
    "deviceAddress": "*",
    "dataType": "*",
    "primary": "127.0.0.1:9090",
    "mirrors": [],
    "replyPolicy": "none"
  }
}
```

`defaultRoute` 可以设为 `null`，此时没有匹配规则的完整报文会被丢弃并记录日志。旧版
`{"targets":["host:port"]}` 配置仍可读取，并会转换成默认路由。

配置更新对新建立的设备连接生效；已经连接的设备保持连接建立时的路由快照，重连后使用新配置。
