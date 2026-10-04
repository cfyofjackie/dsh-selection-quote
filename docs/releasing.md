# 发布

包本身**已经准备好发布**（`private` 已移除、`publishConfig.access: public`、`files` 只列该发的、`prepublishOnly` 会先重新构建 + 跑测试）。卡住的是**账号**，不是包。

## 现状：发不了，原因记在这儿

想注册 npm 账号时踩到两堵墙，都跟包无关：

**墙 1：npm 官网的反机器人防护（DataDome）按 IP 拦人。**
出口 IP 是 `38.118.15.x`（VPN/机房段）时，`https://www.npmjs.com/signup` 返回 **403** 和一张「访问暂时受限」的图，理由写的是"您使用的 IP 位址与网路机器人相同"。
命令行也一样：`curl https://www.npmjs.com/signup` → **403**。而包仓库 `registry.npmjs.org` 不受影响（`npm view` 正常应答）——**被拦的只是网站**。

**墙 2：命令行建账号这条路官方已废弃。**
`npm adduser --auth-type=legacy` 会返回：

```
npm notice Account creation via legacy auth is unavailable.
           Please set your auth-type to "web" or visit https://www.npmjs.com/signup
npm error 403 Forbidden - PUT https://registry.npmjs.org/-/user/org.couchdb.user:<名字>
```

（npm 11 的 `lib/utils/auth.js` 里 `adduserCouch` 代码还在，但仓库端已经不接受了。）

所以：**注册必须走网站，而网站被 IP 拦着。** 换一个信誉干净的出口（换 VPN 节点、换网络、或手机热点）是唯一出路。

## 等能注册了，完整流程

```sh
# 1. 浏览器打开 https://www.npmjs.com/signup 注册（用户名全小写、邮箱要能收信）
# 2. 回本机登录（会弹浏览器，点 Authorize）
npm login
npm whoami     # 应打印你的用户名
# 3. 发布
cd /path/to/dsh-selection-quote
npm publish
```

`prepublishOnly` 会先跑 `node build.mjs && node --test`，所以发出去的 `lib/` 一定是当前源码构建的、而且测试通过。

发布前想先看会发什么（不需要登录）：

```sh
npm publish --dry-run
```

当前是 7 个文件、约 14 kB：`LICENSE`、`README.md`、`README.en.md`、`cordis.patch.yml`、`lib/index.js`、`lib/client.js`、`package.json`。`src/`、`tests/`、`docs/` 都不进包。

## 在那之前：用 git tag 代替

npm 能提供的两件事里，「锁版本」这件事 git tag 也能给：

```sh
dsh plugin --profile web add github:cfyofjackie/dsh-selection-quote#v0.1.0
```

新版本：

```sh
git tag -a v0.1.1 -m "v0.1.1"
git push --follow-tags
```

## 发完之后

安装命令从 GitHub 地址变成裸包名，和官方插件（`@deepseek-ai/dsh-experimental-*-bundle`）形态完全一致：

```sh
dsh plugin --profile web add dsh-selection-quote
```

记得把两个 README 里那条 `github:...#v0.1.0` 换成裸包名。

## 注意

- 一旦发布，**同一个版本号不能重发**（`npm unpublish` 有 72 小时限制且会留痕）。发错了就发下一个 patch。
- 想改版本号：`npm version patch|minor|major`（会改 `package.json` 并打 tag），然后 `git push --follow-tags`。
- `lib/` 是提交进仓库的。改完源码请 `npm run build` 一起提交，否则 CI 的 "committed lib/ matches the source" 会失败。
