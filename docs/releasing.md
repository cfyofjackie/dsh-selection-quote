# 发布到 npm

包**已经准备好发布**（`private` 已移除、`publishConfig.access: public`、`files` 只列该发的），缺的只是登录和一条命令。

## 前提

- npm 账号，并且已经 `npm login`。本机当前**没有登录**：`npm whoami` 报 `ENEEDAUTH`。
- 包名没被占用。`npm view dsh-selection-quote` 返回 404 就是空闲（查的时候是空的）。

## 发布

```sh
npm publish
```

`package.json` 里的 `prepublishOnly` 会先跑 `node build.mjs && node --test`，所以**发出去的 `lib/` 一定是当前源码构建的、而且测试通过**——不会出现提交的产物和源码不一致的包。

发布前想看会发什么：

```sh
npm pack --dry-run
```

当前是 7 个文件、约 14 kB：`LICENSE`、`README.md`、`README.en.md`、`cordis.patch.yml`、`lib/index.js`、`lib/client.js`、`package.json`。`src/`、`tests/`、`docs/` 都不进包。

## 发完之后

安装命令从 GitHub 地址变成裸包名，**和官方插件形态完全一致**：

```sh
dsh plugin --profile web add dsh-selection-quote
```

（官方那批是 `@deepseek-ai/dsh-experimental-*-bundle`，同一个形状：npm 包 + 声明 `dsh.bundle`。）

## 版本

改了用户可见的行为就：

```sh
npm version patch    # 或 minor / major
git push --follow-tags
```

`npm version` 会改 `package.json` 的版本号并打 git tag；tag 要记得推。

## 注意

- 一旦发布，**同一个版本号不能重发**（`npm unpublish` 有 72 小时限制且会留痕）。发错了就发下一个 patch。
- `lib/` 是提交进仓库的。改完源码请 `npm run build` 并一起提交，否则 CI 的 "committed lib/ matches the source" 那一步会失败。
