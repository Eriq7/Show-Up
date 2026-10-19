# Show Up 调试记录

> 给接手的 Agent：动代码前先读完这份。修完一个 bug，在「记录」最上面追加一条，格式照抄已有的。

## 调试前必须知道的事

- **单文件应用**：所有逻辑都在 `index.html` 的 `<script>` 里，没有构建步骤。`plan.md` 是最初的产品设计。
- **部署**：GitHub `Eriq7/Show-Up`，推到 `main` 会由 Vercel 自动部署到生产环境。推送前先问用户。
- **使用方式**：用户在 iPhone 上用，大概率是「添加到主屏幕」的 Web App（有 `manifest.webmanifest` 和 `apple-touch-icon`，没跟用户确认过）。
- **数据只在手机上**：存在手机浏览器 localStorage 的 `showup:state` 里，只有一份最新状态，没有历史，也没有服务器。Agent 看不到用户的数据，丢了就找不回。用户只能描述现象，所以根因要靠读代码找。
- **状态模型**：
  - `state.routines.{chest,shoulders,back}.exercises`：下次训练的模板。
  - `state.activeSession`：进行中的那一场，**同一时间只有一场**。
  - `finishSession()`：把 `activeSession` 拷回对应部位的模板并清空。结束训练、4 小时自动结束、切换部位都走它。
  - 每次改 `state` 后都要调 `save()`。`render()` 是路由入口，页面加载和 `hashchange` 时都会调。
- **不要随便改 `showup:state` 的结构**：用户的真实数据就存在这个格式里，要改就得写迁移。

## 调试流程

1. **读代码找根因**。拿不到用户数据，就按用户描述的现象倒推哪条代码路径会出这种结果。
2. **写一条会失败的测试复现它**（见下面「测试」）。按 `tdd` skill：先跟用户确认在哪一层测、测哪几条行为，再一次写一条（红 → 绿）。
3. **用最少的代码让它通过**。再把修复临时拿掉，或者用 `git show HEAD:index.html > index.html` 换回旧代码跑一遍（跑完记得换回来），确认测试真能抓到这个 bug。
4. **用 agent-browser 在真 Chromium 里冒烟测试**（见下面「浏览器工具」）。
5. **iOS 特有的行为让用户在 iPhone 上测**。这台 Mac 没装 Xcode，没有 iOS 模拟器。
6. 在本文件追加记录。

## 测试

```bash
cd tests && npm install && npm test   # 约 2 秒
```

- `tests/phone.mjs`：
  - `Phone` 模拟一部手机，管时钟（`Date.now`）和“磁盘”（localStorage）。`advance(ms)` 拨快时钟，`launch()` 等于杀掉 App 再冷启动，数据从磁盘读回。
  - `App` 只暴露用户能做的动作（点部位、加动作、点格子、打字、点按钮、结束训练）和用户能看到的东西（当前页面、计时器、重量）。
  - `confirm()` 的返回值由 `phone.confirmAnswer` 控制，弹过的文字记在 `phone.dialogs`。
- `tests/session.test.mjs`：测试只写在这一层，即“用户怎么操作 → 下次打开看到什么”。不要在测试里直接断言 localStorage 的内容。
- 测试用 jsdom 加载真实的 `index.html`，不需要拆文件。

### 坑

- **jsdom 用 `setImmediate` 派发 `hashchange`**。等页面切换必须用 `setImmediate`。用 `setTimeout(0)` 会随机失败：实测 12 次里 6 次失败，因为在 Node 里两者谁先执行不固定。
- **jsdom 里点按钮不会让输入框失焦**，移除正在聚焦的输入框也不会触发 `blur`。这一点跟 iOS 很像，正好拿来模拟 iOS。
- **每个 JSDOM 实例的 localStorage 是独立的**，所以 `Phone.kill()` 会手动把数据拷出来，下次 `launch()` 时再写回去。
- **不关窗口进程会挂住**：App 里有 `setInterval`，测试中途抛异常、窗口没关，进程就不会退出。`afterEach` 里要调 `phone.kill()`，临时调试脚本要在 `finally` 里 kill，或者加 `--test-force-exit`。

## 浏览器工具怎么选

- **默认用 agent-browser**：测本地服务器或 Vercel 上的站，不需要登录。它在独立的无头会话里跑，不碰用户自己的 Chrome，还能处理 `confirm` 弹窗（`agent-browser dialog accept` / `dismiss`）。
  - 本地服务器：`python3 -m http.server 8765 --bind 127.0.0.1`
  - 用命名会话：`export AGENT_BROWSER_SESSION=showup-smoke`
  - 弹窗打开时页面会暂停，`get url`、`console` 这类命令会一直卡住。先用 `agent-browser dialog status` 看有没有弹窗，有就先处理掉。
  - 页面变化后 `@eN` 编号会变，先 `snapshot -i` 再点。
  - 在 `open` 之前设 `agent-browser viewport 390 844` 没生效，截图还是 1280 宽。原因没查。
  - 有 Xcode 的话，`agent-browser -p ios` 可以驱动 iOS 模拟器里的真 Safari。这台机器上没有。
- **Claude in Chrome**：只在需要用户登录态时用。它的规则是不能触发 alert/confirm，否则扩展会卡住。而本 App 切换部位、删除组、删除动作都会弹原生 `confirm`。

## iOS 已知行为

- `input.focus()` 必须在用户手势（点击）的同步调用栈里执行，否则不弹键盘（见 e367972）。改 `startCellEdit` 时不要把 `focus()` 挪进 `setTimeout` / `requestAnimationFrame`，也不要挪到整页重渲染之后。
- 点按钮不一定会让正在编辑的输入框失焦（推断，没在真机上验证过）。所以格子的值在每次 `input` 事件时就保存，不依赖 `blur`。

---

## 记录

### 2026-10-19：忘了结束训练 / 数据回到上上次

**现象**（用户描述）
1. 练完忘点「结束训练」，下次打开计时显示几十甚至几百小时。
2. 大约 10% 的情况，用户记得已经结束了，下次进来数据却是上上次的，包括动作改名也没了。

**根因**
- `enterRoutine()` 发现进行中的训练属于别的部位时，会直接用新训练覆盖 `activeSession`，旧那场从来没写回模板。比如训练没结束（忘了点，或者「结束训练」的确认弹窗点到了遮罩/取消），下次去练别的部位，那场就悄悄丢了；再练这个部位时，看到的是上上次的模板。**现象 2 和现象 1 是同一个根因**，不是 localStorage 不稳定。
- 次要原因（推断）：格子以前只在 `blur` 时保存。`renderWorkout()` 用 `innerHTML = ''` 重建页面时，正在编辑的输入框被直接移除，不会触发 `blur`。所以键盘没收就点「开始休息」或「结束训练」，刚输的数会丢。

**修复**（2026-10-19 的提交）
- 新增 `finishSession()`，结束训练、自动结束、切换部位都用它。
- 4 小时自动结束（`SESSION_MAX_MS`）：
  - `render()` 开头调 `endStaleSession()`。
  - `updateTimers()` 每秒检查 `isStale()`，超时就调 `render()`。这是为了处理 App 一直挂在后台、页面没重新加载的情况。
- 4 小时内切换部位：弹 `confirm`「X训练还没结束。保存X训练，开始Y训练？」。点取消时 `enterRoutine()` 返回 `false`，`render()` 调 `goHome()`。弹窗而不是静默保存，是用户自己选的。
- 格子编辑：
  - 每次 `oninput` 都写入并 `save()`。
  - 输入框拿的是那一组 `set` 对象的引用，不用下标，因为删掉某一组后下标会移位。
  - Escape 会恢复原值。

**验证**
- `tests/session.test.mjs` 共 7 条。旧代码 7 条全部失败，新代码全部通过。
- agent-browser 在真 Chromium 里测过三条路径：键盘没收时数字已经存进去；切换部位的弹窗；把训练改成 3 天前开始后，计时归零、数据还在。没有 JS 报错。

**没做 / 待确认**
- **多标签页覆盖**：`load()` 只在页面加载时跑一次。如果同时开着两个标签页，旧标签页内存里的 `state` 会在它下一次 `save()` 时覆盖新数据。主屏幕 Web App 只有一个实例，所以判断这不是这次的原因，没修。以后如果又出现“数据被回滚”，而且排除了上面的根因，先查这个。修法是在 `visibilitychange` / `pageshow` 时重新 `load()`。
- **新弹窗用的是原生 `confirm()`**：de1309d 曾经把「结束训练」的原生弹窗换成了自定义的底部弹窗。如果用户嫌原生弹窗难看，可以照 `#end-confirm-overlay` 改。
- **误进一个部位的训练页、马上退出再点另一个部位，也会弹窗**，因为进训练页就算开始了一场。点确定即可，数据不会变。
- **还要用户在 iPhone 上验证两件事**：切换部位的弹窗；不收键盘直接点「开始休息」后数字是否还在。
- **`lastTrainedAt`**：自动结束时记的是结束那一刻，不是真实训练时间。目前 UI 没用到这个字段。

### 更早的修复（从 git log 整理）

- **e367972（2026-06-07）iOS 数字格要点 2–3 次才弹键盘**：`focus()` 放在 `requestAnimationFrame` 里异步调用，而 iOS 要求在用户手势的同步栈内调用。改成就地把 span 换成 input，并同步调 `focus()`。
- **de1309d（2026-06-07）**：
  - 双击编辑改成单击，因为双击在 iOS 上会触发缩放。
  - 禁用页面缩放。
  - 「结束训练」的原生 `confirm` 换成自定义底部弹窗。
