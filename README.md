# dsh-cost-monitor

DSH（DeepSeek Harness）Web 插件：在 Web GUI 的 composer 统计条（`conversation.composer.dock`，官方 token 统计行下方）显示**当前会话的 API 费用估算**。

与现成 `dsh-session-cost` 的区别：**按每次请求的实际模型精确计价**（会话中途切换模型后，切换前的 token 仍按当时模型的价格计费），价格表**可通过配置覆盖**。

## 安装

```bash
# 从 GitHub 安装（会自动构建，见下）
dsh plugin --profile web add github:LeeTedLHK/dsh-cost-monitor

# 或本地开发：克隆后构建再安装
# git clone https://github.com/LeeTedLHK/dsh-cost-monitor.git
# cd dsh-cost-monitor && pnpm install && pnpm build
# cd <你的 dsh 工作目录> && pnpm dsh plugin --profile web add ./dsh-cost-monitor
```

从 git 安装会运行包的 `prepare` 构建脚本，pnpm ≥10 首次会拦截它；按 pnpm 提示把包 key 加入 profile 的 `pnpm-workspace.yaml` `allowBuilds` 后重试 `add`（与官方插件安装流程一致）。

安装后**重启 `dsh web`**（host 半新插件需重启加载），然后硬刷新浏览器（`Ctrl+Shift+R`）。

## 怎么算的

- 数据源：会话日志中每次 `assistant/message`（或 usage chunk）携带的 provider 报告用量（`uncachedInputTokens` / `cacheReadTokens` / `cacheWriteTokens` / `outputTokens`），与官方 `dsh-token-meter` 的 `tokenUsage` 投影同源
- 精确计价：每次请求的模型取自该请求的 `request/header` 配置；会话中途 `selectModel` 切换后，后续请求按新模型计价，历史请求保持原模型价格
- 计费口径（对应官方账单）：缓存**写入**按「未命中」单价计
  `费用 = (未命中 + 写入) × miss单价 + 命中 × hit单价 + 输出 × out单价`
- 价格：默认内置 DeepSeek 官方价（2026-08-17 起峰谷定价，见 https://api-docs.deepseek.com/zh-cn/quick_start/pricing），可在 cordis.yml 覆盖

| 模型 | 百万输入（命中） | 百万输入（未命中） | 百万输出 |
| --- | --- | --- | --- |
| deepseek-v4-flash · 高峰（9-12/14-18 北京时间） | ¥0.10 | ¥3 | ¥9 |
| deepseek-v4-flash · 空闲 | ¥0.05 | ¥1.5 | ¥4.5 |
| deepseek-v4-pro · 高峰 | ¥0.30 | ¥9 | ¥27 |
| deepseek-v4-pro · 空闲 | ¥0.15 | ¥4.5 | ¥13.5 |

高峰时段按请求发生时间（北京时间，UTC+8）判断，默认 `9:00-12:00`、`14:00-18:00` 半开区间。

## 配置

插件行配置（`cordis.yml` 或 profile 的 `cordis.patch.yml`）：

```yaml
- id: cost-monitor
  name: dsh-cost-monitor
  config:
    pricing:
      deepseek-v4-flash:
        miss: 1.5          # 每百万 tokens，输入未命中（缓存写入同此价）
        hit: 0.05          # 每百万 tokens，输入命中
        out: 4.5           # 每百万 tokens，输出
        peak: { miss: 3.0, hit: 0.10, out: 9.0 }   # 高峰价；缺省用平值
      deepseek-v4-pro:
        miss: 4.5
        hit: 0.15
        out: 13.5
        peak: { miss: 9.0, hit: 0.30, out: 27.0 }
      # 自定义模型：键可用 "provider/model" 或裸 model id
      'my-gateway/my-model':
        miss: 2
        hit: 0.1
        out: 6
    peakHours: [[9, 12], [14, 18]]   # 高峰时段（北京时间，半开区间）
```

未配置价格的模型按 0 计费并在统计行显示「未知价:N」。

## 说明与限制

- **估算值非账单**：基于 provider 报告的 usage × 配置价格，四舍五入、缓存口径差异可能与真实账单有出入
- 价格以配置为准；官方调价后请更新配置
- 与 `dsh-token-meter` 的 `tokenUsage` 一致：同一步（turn/step）的 usage chunk 与最终 message 只计一次
- 仅支持 Web（`platform: web`）；headless/TUI 无 UI

## 开发

```bash
pnpm install
pnpm test        # vitest（pricing + projection fold）
pnpm build       # tsc 类型 + tsdown → lib/index.js + lib/client.js
pnpm typecheck
```

## 协议

MIT
