# dsh-selection-quote

[![CI](https://github.com/cfyofjackie/dsh-selection-quote/actions/workflows/ci.yml/badge.svg)](https://github.com/cfyofjackie/dsh-selection-quote/actions/workflows/ci.yml)

[English](README.en.md) | 中文

在 DSH 对话里选中一句话，把它作为**引用**放进输入框——一个可以整体删除的引用对象，不是被粘进去的文本。

## 安装

网页版和桌面 App 是同一套流程。打开侧边栏 **Plugins** → **添加插件**，把下面这一串粘进去，点「安装」：

```
github:cfyofjackie/dsh-selection-quote
```

> ⚠️ **安装源请选 `NPM`，不要选「中国大陆镜像源」。** 选后者时这个对话框会失败，报
> `无法获取插件信息：client api: pluginManager/inspect failed: Load failed`。
> 已复现：同一台机器、同一个地址，换成 `NPM` 立刻成功。

装完**刷新一次页面**即可（桌面 App 若没反应就重启它）。

<details>
<summary>用命令行 / 锁版本 / 隔离试装 / 不用包管理器</summary>

### 命令行

一条命令做完「装包 + 挂载」两件事。网页版和桌面 App 各一条：

```sh
dsh plugin --profile web add github:cfyofjackie/dsh-selection-quote
```

```sh
dsh plugin --profile desktop add github:cfyofjackie/dsh-selection-quote
```

### 锁版本

在地址后面接一个 git tag：

```sh
dsh plugin --profile web add github:cfyofjackie/dsh-selection-quote#v0.1.0
```

### 隔离试装

独立 `DSH_HOME`，不碰你现有的档位：

```sh
CLI="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
export DSH_HOME=/tmp/dsh-sandbox
"$CLI" --profile sandbox --from-default-profile web --dump-config
"$CLI" plugin --profile sandbox add github:cfyofjackie/dsh-selection-quote
"$CLI" --profile sandbox --port 3917
```

全新的 `DSH_HOME` 里没有任何模型凭证，界面能开、插件能注册，但没法真的对话。想让它能聊天，把 `~/.dsh/.credentials.yaml` 拷进 `/tmp/dsh-sandbox/`。（`dsh web` 会打印一条带 token 的 URL，要开那条；裸端口是 401。）

### 不用包管理器

在档位的 `cordis.patch.yml` 里直接写绝对路径：

```yaml
- insert:
    - id: dsh-selection-quote
      name: "/绝对路径/dsh-selection-quote/lib/index.js"
```

新建档位的 patch 文件里只有一个 `[]`，要**替换**那一行，不要接在它后面——`[]` 后面跟列表项是 YAML 解析错误，档位会起不来。

### 发布到 npm 之后

命令还能更短，和官方插件形态完全一致——但那需要一个 npm 账号，而且 npm 官网的反机器人防护会拦掉某些出口 IP（详见 [docs/releasing.md](docs/releasing.md)）：

```sh
dsh plugin --profile web add dsh-selection-quote
```

</details>

![在对话中选中一段文字，选区旁浮出「添加到对话框」](docs/demo.png)

## 环境要求

| | |
|---|---|
| **DSH 版本** | 实测于 **`@deepseek-ai/dsh-desktop` `0.2.0-rc.2`**（当前版本）。插件依赖的引用管线 API——`ctx.inputTriggers` 的 codec、`insertReference`——在更早的 `0.1.5-rc.3` 包集合里也存在且签名一致，但那个组合**没有实测过**。 |
| **表面** | 网页版（`dsh web`）和桌面 App 都可以。 |
| **视图** | 只在 **chat** 视图生效；trajectory / waterfall 视图没有它需要的 DOM 锚点。 |
| **语言** | 跟随 DSH 的语言设置，插件内置 `zh` / `en`。 |

如果某个 DSH 构建缺少这些 API，插件**不会静默消失**——它自带的错误边界会把失败显示在界面上。

## 解决什么问题

ChatGPT / Codex 里选中一段话可以「添加到对话」：针对**具体某一句**追问，不用重新描述一遍，也不用担心粘进去以后分不清哪段是引文、哪段是自己的话。DSH 里没有这个动作——只能手动复制粘贴。

## 它做什么

1. 在正文里选中一段文字（助手回复、你自己的消息都行）。
2. 选区旁浮出一个按钮：**添加到对话框**。
3. 点一下，输入框里出现一枚**引用芯片**，标签是选中的开头。
4. 它是一个对象，不是一段字符串：
   - 一个 Backspace 整个删掉，不会删到一半；
   - 和相邻输入同一笔撤销；
   - 复制草稿时摊开成 `> 原文`，贴到别处照样可读；
   - **发送时**才变成模型看到的那段引用。
5. 光标回到输入框，你接着写问题，自己按发送。

它不自动发送、不写任何存储、不改会话日志。

## 怎么做的

引用走的是 DSH 自己的**引用管线**——`@文件` / `@会话` 用的那套，而不是拼一段字符串塞进草稿。三处投影各有人负责：

| 投影 | 谁生产 | 值 |
|---|---|---|
| 芯片上显示的文字 | 插入时的 `label` | `引用：选中的开头…` |
| 复制草稿 / 持久化 | `codec.clipboardText(ref)` | `> 原文` |
| **模型收到的文本** | `codec.serialize(ref)` | `> 原文` |

四个关键决定：

- **包做成 profile bundle**（`dsh.bundle.patch` + `cordis.patch.yml`），和官方插件 `@deepseek-ai/dsh-experimental-*-bundle` 同一个形状，所以安装是一条命令、能被插件管理器识别。
- **`ref` 自包含**：原文用 base64url 编进引用 id 里，解析不依赖插件内存。因为 DSH 对「找不到编解码器」的定义是**拒绝发送**，不是静默降级——不能赌内存里还留着。
- **插入点用 detect 坐标**：composer 把文档走成两套投影，芯片在 detect 投影里恰好占 1 个字符，在剪贴板投影里是完整文本，所以「文档末尾」要折算过去。
- **插件自带一层 error boundary**：slot 的 entry 渲染时崩一次就会被**静默废弃**——loader 里还是 active，页面上什么反应都没有。没有这层边界，前面那些问题根本查不出来。

踩过的坑（含每一条结论对应的源码出处）写在 [docs/gotchas.md](docs/gotchas.md)（英文）。设计取舍——为什么做「引用」而不是「注释」、为什么不做 ChatGPT 那种引用卡片——记在 [docs/design-notes.md](docs/design-notes.md)。

## 已知限制

- 引用插在**文档末尾**，不是光标处——光标不在公开的标准 props 里，而文档末尾可以精确算出来。
- 插入被拒（revision 变了等）时**回退成纯文本引用**：那段话不会丢，只是不再是芯片。
- 单个引用最长 20000 字符，超出会截断并在引用里显式标注，不会静默给模型看半截。
- 引用**不可编辑**：它是原子节点，想改就删掉重新选。
- 输入机处于提交中/已认领状态时按钮置灰。
- 只在 chat 视图生效；trajectory / waterfall 视图没有那些 DOM 锚点。
- 引用**不带出处**（哪条消息）。
- 界面文案跟随 DSH 语言（内置 `zh` / `en`），把 DSH 切成英文就是 "Add to chat"。

## 开发

```sh
npm install --no-save esbuild
npm run build
npm test
```

`npm test` 跑的是**构建产物**而不是 TypeScript 源码：它 stub 掉浏览器全局量和平台种子模块，用一个带 React 错误边界语义的迷你 hook 运行时渲染组件，并按真实事件顺序重放。每一项回归测试都对应这个插件真实出过的一次故障。

`lib/` 是提交进仓库的，所以 clone 下来不用构建就能用。CI 在 ubuntu / windows / macos 三平台、Node 22 和 24 上各跑一遍构建和全部测试，提交的 `lib/` 与源码不一致时会失败。

发布到 npm 的步骤（维护者）：[docs/releasing.md](docs/releasing.md)。

## 许可

MIT —— 见 [LICENSE](LICENSE)。与 DeepSeek 官方无关联。
