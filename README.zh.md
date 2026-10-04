# dsh-selection-quote

[![CI](https://github.com/cfyofjackie/dsh-selection-quote/actions/workflows/ci.yml/badge.svg)](https://github.com/cfyofjackie/dsh-selection-quote/actions/workflows/ci.yml)

在 DSH 对话里选中一段文字，把它作为**引用对象**放进输入框——一枚原子芯片，不是被粘进去的文本。**不发送**。

[English](README.md) | 中文

![在对话中选中一段文字，选区旁浮出「添加到对话框」按钮](docs/demo.png)

## 它做了什么

1. 在对话正文中选中一段非空文字（助手回复、你自己的消息、插话都行）。
2. 选区旁浮出一个胶囊按钮：**「添加到对话框」**。
3. 点击后，输入框里出现一枚**原子引用芯片**，标签是选中的开头：

   ```text
   你原本输入的内容 [引用：选中的开头…] 
   ```

4. 它是编辑器里的一个节点，不是一个字符串：
   - 一个 Backspace 整个删掉，不会删到一半；
   - 和相邻输入同一笔撤销；
   - 复制草稿时摊开成引用文本（`> …`），贴到别处仍然可读；
   - **发送时**由本插件的引用编解码器把它变成模型文本，而不是点击时就把文本拼进草稿。

   所以它和 `@文件` / `@会话` 是同一类东西——DSH 里「输入框中的对象」的标准做法。

5. 焦点回到输入框，你继续补一句问题，再自己按发送。

**它不做的事**：不自动发送、不写任何存储、不改会话日志。

## 引用是怎么变成模型文本的

这是这个插件真正的机制，也是它和「把文本粘进去」的根本区别：

| 投影 | 谁负责 | 值 |
|---|---|---|
| 芯片可见文字 | 插入时给定的 `label` | `引用：选中的开头…` |
| 剪贴板 / 持久化草稿 | `codec.clipboardText(ref)` | `> 选中的原文` |
| **模型收到的文本** | `codec.serialize(ref, signal)` | `> 选中的原文` |

- 引用源注册在 `ctx.inputTriggers.registerSource({ trigger: '@', name: 'quote', codec })`。每枚芯片的 `ReferenceInsert.source` 必须等于这个 `name`，否则提交时找不到编解码器。
- DSH 对找不到编解码器的定义是**拒绝发送**，不是静默降级成剪贴板文本。所以 `ref` 做成自包含的——原文用 base64url 编进 id 里——解析不依赖插件内存。草稿恢复、热重载、来自别的会话的芯片，都一定序列化得出来。
- 插入点用 **detect 坐标**。composer 把文档走成两套投影：`detectText` 里每枚芯片恰好占一个对象替换字符（`\uFFFC`），而 shell 发布成 `InputState.draft` 的剪贴板投影里它是完整文本。所以「文档末尾」要折回去算：

  ```js
  end = state.draft.length - Σ(occurrence.length - 1)
  ```

- 入口是服务自己的报错文案里写明的那条：`ctx.sessions.scope(sessionId).conversation.input.for(actx).insertReference(ref, span)`。
- 插入被拒（revision 变了、span 落不下去）时**回退成纯文本引用**，而不是丢掉这段话。把 `src/client.tsx` 里的 `DIAGNOSTIC` 打开就能看到走了哪条路。

## 安装

插件由「Host 半边 + 浏览器半边」组成，通过 profile 的 patch 文件挂载。macOS / Linux 上桌面档位在 `~/.dsh/profiles/desktop/cordis.patch.yml`：

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: dsh-selection-quote
      name: "/绝对路径/dsh-selection-quote/lib/index.js"
```

Windows 上档位在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`，路径写 Windows 路径。用正斜杠可以少一层 YAML 转义：

```yaml
- insert:
    - id: dsh-selection-quote
      name: "C:/path/to/dsh-selection-quote/lib/index.js"
```

profile 的 patch 会 live 生效，但浏览器已经拿到的 boot graph 不会自己更新——**挂载后刷新一次页面**（macOS 上 Cmd+R，其他平台 Ctrl+R，或重启 DSH）。

卸载就是把这几行删掉再刷新。

`lib/` 是特意提交进仓库的：profile 直接加载 `lib/index.js` 和 `lib/client.js`，所以 clone 下来不需要构建就能用。

### 界面语言

按钮跟随 DSH 的活动语言。插件同时注册了 `zh` 和 `en` 两套字典（`ctx.locale.register`），符合官方约定「语言的回退链必须终结于 English」——所以把 DSH 切成英文就能看到 "Add to chat"，不需要改插件。

## 开发

```sh
node build.mjs          # 生成 lib/index.js 和 lib/client.js
node build.mjs --watch  # 监听 src/
node --test tests/      # 无浏览器冒烟测试
```

唯一的构建工具是 esbuild；`build.mjs` 会依次在插件目录、`$DSH_HOME/profiles/node_modules`、`~/.npm/_npx/*`、DSH 应用自带 runtime 里找它。`DSH_ESBUILD=/path/to/esbuild` 可以指定。

### 产物结构

| 文件 | 作用 |
|---|---|
| `lib/index.js` | Host 半边。必须存在：只有作为 Loader entry 挂载、**并且** package.json 声明了 `dsh.client` 的包，浏览器半边才会被组进 boot graph。这里是空实现。 |
| `lib/client.js` | 浏览器半边，外面包着 `window.__ModuleLoader__.load({ id, factory })` 注册信封，内容是按 CJS 打的 bundle。 |

### 测试

`node --test tests/` 跑的是**构建产物**而不是 TypeScript 源码：它 stub 掉浏览器全局量和平台种子模块，用一个带 React 错误边界语义的迷你 hook 运行时渲染组件，并且按真实事件顺序重放（`pointerdown` 捕获先于 `click`）。每一项回归测试都对应这个插件真实出过的一次故障。

## 踩过的坑

三次失败塑造了现在的设计，三次都**没有任何可见提示**，也都对任何 DSH 客户端插件成立。

### 坑 1：entry 崩一次就被静默废弃

第一版挂上去完全没反应：loader 里插件是 `active`，但 slot 的 inspect 结果是

```json
{"id": "selection-quote", "order": 30, "active": false}
```

`active: false` 在这个 slot core 里只有一个来源 —— `reportEntryError(..., { abdicate: true })`：

```js
// dsh-client-ui-renderer
var SlotErrorBoundary = class extends react.Component {
  static getDerivedStateFromError(error) {
    if (error instanceof SlotAssemblyError) throw error;
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error(`slot entry crashed in '${this.props.slotKey}':`, error);
    this.props.onEntryError(error);   // → abdicated.add(entry)
  }
  // ...
}
```

**entry 在渲染期抛一次错就被永久跳过**，页面上什么都不显示。所以"插件 active"和"功能没反应"可以同时成立——这一点必须靠自己的 error boundary 才能看见。

### 坑 2（真正的元凶）：种子模块的具名导出会在不同 shell 构建之间漂移

红框终于报出真实错误：`Minified React error #130`（*Element type is invalid ... got: undefined*）。堆栈里的资源名暴露了关键事实：

```
at bi (dsh-app://app/assets/index-5SrrfWpU.js:56:49799)
```

**桌面端 serve 的是 `app.asar/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist` 里自带的 dist，不是 profile 里 `node_modules/@deepseek-ai/dsh-web-frontend` 那一份。** 两份是不同构建，同名种子模块的导出名不一样：

| | 桌面端实际在跑的 | profile 里那份 |
|---|---|---|
| 图标命名 | `IconArchiveOutlineRegular` / `…Medium` | `IconArchiveOutline16` / `…20` |
| `IconPlusOutline16` | **不存在** | 存在 |

于是 `import { IconPlusOutline16 }` 解析成 `undefined` → `jsx(undefined, {})` → React #130 → entry 被废弃。

**规则：种子模块里只信任 React 本身（`react` / `react-dom` / `react/jsx-runtime`）。** 其余（`dsh-client-ui-primitives` 等）的具名导出都当作会漂移，需要什么就自己内联——本插件那个 14px 的加号就是内联 SVG。

### 坑 3：按钮要等一两秒才出来——自己造的强制布局

现象：选中文字后，胶囊按钮延迟一两秒才浮出来。诊断条上的 `probes=569` 是线索。

两个原因叠在一起：

1. `selectionchange` 之后垫了一个 `requestAnimationFrame`，把「手势结束」和「按钮出现」隔开至少一帧，页面忙时更久。
2. `scroll` 监听挂在 **document 捕获阶段**，每次触发都对整个选区做一次 `range.getBoundingClientRect()` —— **强制布局**。滚动一次 = 强制布局一次；拖选过程中的自动滚动会连着刷。而拖选期间按钮本来就该藏着，这些布局全白做。

改法：

- **在报告变化的事件里同步测量**，不再经 rAF。`selectionchange` 上报的已经是提交后的选区，不需要等布局稳定。
- **加 `mouseup` / `keyup`** 作为手势结束的直达路径——即使 `selectionchange` 被浏览器推迟，松手那一刻也能出按钮。
- **`scroll` / `resize` 只做重定位**：没有按钮在显示就直接返回；拖选中 `hitRef` 本来就是 null，所以整段拖选零测量。
- **结果去重**：命中内容与位置完全没变就不写 state。

### 三条教训

1. **`useInput` 之类的 selector 一律写成 `state => state?.x ?? fallback`。** 标准 hook 由 `useSnapshotSelector` 绑定，selector 在 render 期被调用，抛一次就整死 entry。
2. **插件自带一层 error boundary。** slot 那层在外侧，抓到就废弃；自己这层在内侧，抓到能把错误画到屏幕上（`SelectionQuoteGuard`）。
3. **不要依赖种子模块的具名导出**（React 除外），否则你的插件会随 shell 构建版本随机失效。

英文版全文（含每一条结论对应的代码出处）：[docs/gotchas.md](docs/gotchas.md)。

## 设计取舍：为什么是「引用到输入框」而不是「注释」

这两件事看起来像，其实目的地完全不同，详见 [docs/design-notes.md](docs/design-notes.md)。一句话版本：

- **引用到输入框**：文字成为你下一条消息的一部分 → 模型能看见。它是**对话行为**，和你要发的那一轮同步发生，也不需要任何新状态。
- **添加注释**：文字附在消息上成为元数据 → 模型看不见。它是**记录行为**，异步、可批量、可回看；成本不在写入，而在**必须再做一套读回来的界面**。

## 已知限制

- **引用插在文档末尾**，不是光标处。光标位置不在公开的标准 props 里（`ComposerKeyboard.caretSpan()` 是包内部面），而"文档末尾"可以精确算出来。
- 插入被拒时**回退成纯文本引用**：那段话不会丢，但就不再是芯片了。
- 单个引用最长 20000 字符，超出会截断并在引用里显式标注 `… (quote truncated)`（这句是给模型看的文本，所以用英文），不会静默给模型看半截。
- 引用**不可编辑**：它是原子节点，想改就删掉重新选。
- 输入机处于 `adjudicating` / `claimed` / `submitting` 阶段时按钮置灰，不写入。
- 只在 chat 视图里生效（选区必须落在 `[data-chat-flow]` 里的可引用节点上）；trajectory / waterfall 视图没有这些 DOM 锚点。
- 选区跨多个消息节点时，按起点所在节点的类型判定。
- 引用**不带出处**（哪条消息）。`INCLUDE_PROVENANCE` 常量留了口子。

## 兼容性

针对 DSH `0.1.5-rc.3` 的客户端包、在 macOS 桌面档位上构建与验证。它刻意只依赖平台种子里的 React，所以 shell 构建改名自己的导出时不会连带失效。

**平台支持。** 插件本身没有任何 OS 相关代码：浏览器半边是 React + DOM API，构建脚本只用 `node:fs` / `node:path`。可能出问题的几处都单独处理了：

- esbuild 搜索同时覆盖 POSIX 和 Windows 位置（`%LOCALAPPDATA%\npm-cache\_npx`、`%PROGRAMFILES%` 下的打包 runtime），并且 `DSH_ESBUILD` 可以直接指定；
- `lib/` 已提交，用户根本不需要跑构建——Windows 用户要做的只是把 patch 指向那个路径；
- 换行符由 `.gitattributes` 钉住，esbuild 输出会规范化成 LF，并且有一条测试断言提交的 bundle 里没有 CRLF；
- 导入 Host 半边的测试走 `pathToFileURL`，因为 `import('C:\\…')` 在 Windows 上会被当成不支持的 URL scheme 拒绝；
- CI 在 **ubuntu / windows / macos** 三平台上跑构建和全部测试，并且会在提交的 `lib/` 与源码不一致时失败。

**没有验证的是 DSH 自己的 Windows 构建**：桌面端 Electron shell（以及它到底 serve 哪份 dist）我只在 macOS 上查过。真在那边出问题的话，插件的 `DIAGNOSTIC` 开关会直接告诉你卡在哪一道门槛。

与 DeepSeek 官方无关联。

## 许可

MIT —— 见 [LICENSE](LICENSE)。
