# MemoryPack Service v1 (stdio JSON-RPC)

**服务名：** `dsh-memory-memorypack`  
**版本：** `1.0.0`  
**实现：** `tools/memorypack-service.mjs`  
**测试：** `tools/memorypack-service.test.mjs`  
**性质：** read-only；由受信 host/Fleet 启动；不写 vault，不调用 DSH/worker/MCP。

## 1. 目的

把 dsh-memory 的 MemoryPack producer 作为**独立进程**提供给 Workbench/Fleet
部署侧使用，而不是在工作树内复制 producer 或 import 实现。服务只回答
`getPack` / `createPackRef`，没有写入、迁移、review、purge 或任意路径接口。

服务进程由 host 用受信配置启动：

```text
node tools/memorypack-service.mjs \
  --vault-root <absolute-vault-root> \
  --workspace <workspace-id> \
  [--episode <episode-id>] \
  [--workspaces <comma-separated-ids>] \
  [--roles <comma-separated-roles>]
```

`--vault-root`、`--workspace` 必填；`--workspaces` 默认等于当前 workspace；
`--roles` 默认全部冻结角色。未知/非法/disabled workspace 由 MemoryPack service
自身 fail closed。

## 2. 传输

- stdio；每行一个 JSON-RPC 2.0 消息。
- stdout 只输出协议帧；诊断只写 stderr。
- 请求/响应 id 由客户端生成；服务端不解释模型或 prompt。
- 服务进程没有网络监听、没有 HTTP、没有 shell、没有任意文件读取工具。

## 3. 方法

### `initialize`

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
```

```json
{"jsonrpc":"2.0","id":1,"result":{
  "ok": true,
  "contract_version": "1.0.0",
  "service": "dsh-memory-memorypack"
}}
```

### `getPack`

参数必须是受信 host 从 Fleet binding 生成的上下文：

```json
{
  "workspace_id": "ws_a",
  "episode_id": "ep_1",
  "role": "researcher",
  "run_id": "run_…",
  "task_id": "analysis_a",
  "purpose": "fleet-worker-context",
  "max_entries": 100
}
```

返回 MemoryPack **1.1.0** 只读 pack（字段与 `MEMORYPACK_V1_1.md` 一致）：

```json
{"jsonrpc":"2.0","id":2,"result":{"ok":true,"pack":{ "...": "MemoryPack v1.1.0" }}}
```

失败时返回领域错误，不泄露 vault 路径：

```json
{"jsonrpc":"2.0","id":2,"result":{
  "ok": false,
  "error": {"code": "memory-scope-invalid", "message": "memory pack request failed"}
}}
```

### `createPackRef`

```json
{"workspace_id":"ws_a","episode_id":"ep_1","role":"researcher"}
```

```json
{"jsonrpc":"2.0","id":3,"result":{
  "ok": true,
  "ref": {
    "snapshot_id": "mp_…",
    "snapshot_hash": "…",
    "workspace_id": "ws_a",
    "episode_id": "ep_1"
  }
}}
```

### `shutdown`

返回 `{"ok":true}` 后进程退出。客户端可以关闭 stdin 作为失败时的兜底。

## 4. 信任与安全

- vault root、workspace registry、allowed roles 来自 host 启动参数，不是模型参数。
- `workspace_id/episode_id/role/run_id` 由 host/Fleet binding 传入；服务端只接受
  `createMemoryPackContext` 校验后的字段。
- 服务不读取 ambient environment 作为身份，不调用 provider/model，不连接
  SecurityLab/vcan/设备。
- 没有写入接口；worker 输出不能通过本服务变成 memory 或 Evidence。
- 错误消息固定，不回显绝对路径、未授权记录、正文或计数。
- 版本不匹配/非法 scope/未知 role 一律 fail closed；消费方不得猜测兼容。

## 5. 与 MemoryPack 1.1.0 的关系

本服务协议版本为 `1.0.0`，**独立于** MemoryPack 数据契约 `1.1.0`。
服务返回的 pack 仍必须按 MemoryPack 1.1.0 schema/语义校验；服务版本变化不自动
改变 pack 版本。

## 6. 验证

```text
node --test tools/memorypack-service.test.mjs
node --test tools/*.test.mjs
```

测试只使用 `mkdtemp` synthetic vault；spawn 真实 service 进程；覆盖 initialize、
getPack、createPackRef、非法 role、未知方法、shutdown。不读取真实 vault、凭据、
provider 或设备。
