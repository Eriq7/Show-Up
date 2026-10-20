# Show Up 调试记录

> 给接手的 Agent：动代码前先读完这份。修完一个 bug，在「记录」最上面追加一条，格式照抄已有的。

## 调试前必须知道的事

- **单文件应用**：所有逻辑都在 `index.html` 的 `<script>` 里，没有构建步骤。`plan.md` 是最初的产品设计。
- **部署**：GitHub `Eriq7/Show-Up`，推到 `main` 会由 Vercel 自动部署到生产环境。推送前先问用户。
- **使用方式**：用户在 iPhone 上用，大概率是「添加到主屏幕」的 Web App（有 `manifest.webmanifest` 和 `apple-touch-icon`，没跟用户确认过）。
- **数据在两处**：App 实际用的是手机 localStorage 里的 `showup:state`。登录后会同步到 Supabase（见下面「云端」），没登录就只在手机上。Agent 能用 `supabase db query --linked` 查云端数据，但查不到没登录的手机。
- **状态模型**：
  - `state.routines.{chest,shoulders,back}.exercises`：下次训练的模板。每个动作是 `{ name, note, sets }`。`note` 是 2026-10-19 加的，之前存的数据没有这个字段，读的时候按空字符串处理（`ex.note || ''`）。
  - `state.activeSession`：进行中的那一场，**同一时间只有一场**。
  - `finishSession()`：把 `activeSession` 拷回对应部位的模板并清空，同时把这次训练放进“待上传”队列。结束训练、4 小时自动结束、切换部位都走它。
  - 每次改 `state` 后都要调 `save()`。它写 localStorage，并标记“有改动没上传”、触发同步。从云端拉下来的数据用 `writeState()` 写，不算改动。
  - `render()` 是路由入口，页面加载和 `hashchange` 时都会调。
- **同步用的另外两个 key**（`showup:state` 的结构没变）：
  - `showup:sync`：`{ userId, dirty, localUpdatedAt, cloudSeenAt }`。`dirty` = 有改动没上传；`cloudSeenAt` = 上次上传或下载时云端那份的 `updated_at`。云端的值跟它不一样，说明别的设备改过。
  - `showup:pending`：结束了但还没传进云端历史的训练，按时间先后排。
- **同步规则**（`syncOnce()`）：先补传 `pending`，再拉云端那份比较：
  - 云端没变：本地有改动就上传。
  - 云端变了，本地没改动或本地是空的：用云端的。
  - 两边都改了：以 `updated_at` 新的为准，旧的那份存进 `state_backups`，不丢。
  - 什么时候同步：每次 `save()` 后、`online`、`pageshow`、切回前台（`visibilitychange`）、App 开着时每 30 秒。iOS 没有后台同步，App 关着时不会上传。
- **不要随便改 `showup:state` 的结构**：用户的真实数据就存在这个格式里，要改就得写迁移。
- **绝不能让用户删除或重新添加主屏幕图标，也不能让用户清 Safari 的网站数据。** iOS 上每个主屏幕图标有自己独立的存储，跟 Safari 不共用。图标删掉，那份数据就再也打不开了（2026-10-19 真的因此丢过一次数据，见下面的记录）。要让手机加载新版本，就说：“在多任务界面把 App 上滑关掉，再从同一个图标打开，不要删图标。”
- **正式网址只有 `show-up-rose.vercel.app`**。不要把 Vercel 部署专属的随机网址（`show-xxxx-eriq7s-projects.vercel.app`）发给用户当入口。

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
- `tests/cloud.mjs`：假的云端，替换的是 App 的云端适配层（`window.showUpCloud`），不是 supabase-js。
  - 一个 `Cloud` 就是服务器。把同一个 `cloud` 传给第二个 `new Phone(cloud)`，就模拟换手机或删了图标重新添加。
  - 登录状态存在那个 App 的 localStorage 里，跟真 SDK 一样，所以 `kill()` / `launch()` 后还是登录状态，新 Phone 则没登录。
  - `phone.goOffline()` / `phone.goOnline()` 切换网络，`goOnline()` 会派发 `online` 事件。`cloud.lastCode(email)` 是发到这个邮箱的最新验证码。
  - `phone.settle()` 等 App 停止访问云端。`launch()`、`endWorkout()`、登录相关的方法里都已经调过了。
- `tests/session.test.mjs`（训练流程）和 `tests/sync.test.mjs`（同步、登录）：测试只写在这一层，即“用户怎么操作 → 下次打开看到什么”。不要在测试里直接断言 localStorage 的内容。云端是系统边界，可以断言云端收到了什么，比如 `cloud.workouts(email)`。
- 测试用 jsdom 加载真实的 `index.html`，不需要拆文件。jsdom 不会加载 CDN 上的 supabase-js，所以测试里只有假云端。

### 坑

- **jsdom 用 `setImmediate` 派发 `hashchange`**。等页面切换必须用 `setImmediate`。用 `setTimeout(0)` 会随机失败：实测 12 次里 6 次失败，因为在 Node 里两者谁先执行不固定。
- **jsdom 里点按钮不会让输入框失焦**，移除正在聚焦的输入框也不会触发 `blur`。这一点跟 iOS 很像，正好拿来模拟 iOS。
- **每个 JSDOM 实例的 localStorage 是独立的**，所以 `Phone.kill()` 会手动把数据拷出来，下次 `launch()` 时再写回去。
- **不关窗口进程会挂住**：App 里有 `setInterval`，测试中途抛异常、窗口没关，进程就不会退出。`afterEach` 里要调 `phone.kill()`，临时调试脚本要在 `finally` 里 kill，或者加 `--test-force-exit`。

## 云端（Supabase + Brevo）

- **项目**：Supabase `show-up`，ref `hirgxetardfgzaskcczo`，地区 ca-central-1，组织 `Eriq7's Org`（免费版）。仓库已 `supabase link`。
  - 数据库密码在 macOS 钥匙串，条目 `supabase-show-up-db`。用法：`export SUPABASE_DB_PASSWORD="$(security find-generic-password -s supabase-show-up-db -w)"`。
  - 免费版 7 天没人用会自动暂停。用户每周都练，不用管。
- **表**（`supabase/migrations/`，用 `supabase db push` 推）：
  - `user_state`：每人一行，存当前数据。
  - `workouts`：训练历史，只能插入，不能改也不能删。`(user_id, client_id)` 唯一，所以重试上传不会重复。
  - `state_backups`：两边冲突时，较旧的那份存这里。
  - 权限全靠 RLS（`user_id = auth.uid()`）。改了表或规则后跑 `supabase db query --linked -f supabase/checks/rls.sql`，结果应该是报错 `RLS CHECK PASSED (rolled back)`。它会模拟两个用户，最后整体回滚，不留数据。
- **App 里**：URL 和 publishable key 直接写在 `index.html` 里，这是公开的，安全靠 RLS。supabase-js 从 jsdelivr 加载，锁定 `2.117.2`。所有网络调用都在 `supabaseCloud()` 里，失败时抛出带 `code` 的错误，`'offline'` 表示没连上（Chrome 报 `Failed to fetch`，Safari 报 `Load failed`，2026-10-19 实测）。
- **登录**：邮箱 + 密码，验证码是 6 位（项目默认是 8 位，已改）。注册用 `verifyOtp` 的 `type: 'email'`，忘记密码用 `type: 'recovery'`。这两种在真实项目上都测通过（2026-10-19）。不用邮件链接，因为主屏幕 App 里点链接会跳到 Safari，登录完成不了。
- **`supabase config push` 的坑**（CLI 2.109.1）：
  - **不会先问就直接推**，也没有 dry-run。往 stdin 塞个 `n` 也照推。
  - 推的是整份 `config.toml`。`[storage.vector] enabled = true` 在免费版会报 402，已改成 `false`。
  - `config.toml` 里**没有** `[auth.email.smtp]` 这一节，所以推送时不会动后台的 SMTP 设置（查过 CLI 源码 `pkg/config/auth.go`：`Smtp == nil` 就不改）。**不要加这一节**，加了就会用本地值覆盖后台，还要求有 SMTP 密码。
  - 免费版没配自定义 SMTP 时不能改邮件模板，会报 400。
- **发信**：Supabase 后台 → Authentication → Emails → SMTP Settings，用的是 Brevo。
  - Host `smtp-relay.brevo.com`，Port 587，Username `b19655001@smtp-brevo.com`，发件人 `ericli6897@gmail.com`，名字 `Show Up`。
  - 收件人看到的发件地址是 `ericli6897@11638357.brevosend.com`，因为 Brevo 会改写 Gmail 发件人。
  - 密码是 Brevo 的 SMTP key `show-up`，用户自己在后台填的，Agent 不经手。
  - **这个 key 连续 90 天没用就会失效**（Brevo 的规则，有效期选了“永不过期”也一样）。失效后注册和忘记密码的邮件会发不出去，已经登录的人不受影响。遇到“收不到验证码”先查这个。

## 浏览器工具怎么选

- **默认用 agent-browser**：测本地服务器或 Vercel 上的站，不需要登录。它在独立的无头会话里跑，不碰用户自己的 Chrome，还能处理 `confirm` 弹窗（`agent-browser dialog accept` / `dismiss`）。
  - 本地服务器：`python3 -m http.server 8765 --bind 127.0.0.1`
  - 用命名会话：`export AGENT_BROWSER_SESSION=showup-smoke`
  - 弹窗打开时页面会暂停，`get url`、`console` 这类命令会一直卡住。先用 `agent-browser dialog status` 看有没有弹窗，有就先处理掉。
  - 页面变化后 `@eN` 编号会变，先 `snapshot -i` 再点。
  - 在 `open` 之前设 `agent-browser viewport 390 844` 没生效，截图还是 1280 宽。原因没查。
  - 有 Xcode 的话，`agent-browser -p ios` 可以驱动 iOS 模拟器里的真 Safari。这台机器上没有。
- **Claude in Chrome**：只在需要用户登录态时用。它的规则是不能触发 alert/confirm，否则扩展会卡住。而本 App 切换部位、删除组、删除动作都会弹原生 `confirm`。
- **账号相关的必须让用户自己来**：不管用哪个浏览器，Agent 都不能注册账号、输密码、输验证码、往设置里填密钥。App 的登录要经过 supabase.co，不算纯本地测试，所以没有例外。分工是：用户登录、输验证码，登录后不涉及密码的操作 Agent 可以在 Chrome 里接着点。
- **本地测“新设备”**：同一个服务器用 `127.0.0.1:8765` 和 `localhost:8765` 打开，浏览器把它们当成两个网站，各有一份 localStorage。

## iOS 已知行为

- `input.focus()` 必须在用户手势（点击）的同步调用栈里执行，否则不弹键盘（见 e367972）。改 `startCellEdit` 时不要把 `focus()` 挪进 `setTimeout` / `requestAnimationFrame`，也不要挪到整页重渲染之后。
- 点按钮不一定会让正在编辑的输入框失焦（推断，没在真机上验证过）。所以格子的值在每次 `input` 事件时就保存，不依赖 `blur`。

---

## 记录

### 2026-10-19：每个动作加备注

**做了什么**
- 动作卡片分成三块：名称、组数表格、备注。
- 备注框一开始一行高，跟着内容自动变高。做法是用一个隐藏的 `::after` 复制同样的文字来撑开网格，所以不用 JS 测高度。
- 每次输入都保存，跟数字格一样。开始新一场训练时，备注从模板带过来；结束训练时，跟着动作写回模板。
- 删掉动作后再按同名添加，备注也会从模板带回来。
- `showup:state` 没有改结构，只是动作多了一个可选的 `note` 字段，旧数据不用迁移。

**验证**
- 测试加了 2 条，共 16 条：
  - 备注下次训练还在。
  - 没有 `note` 的旧数据能正常打开。
- 把“开始训练时带上备注”那行临时去掉，第一条会失败。
- agent-browser 实测：空的 41px，写到三行 83px，删短后缩回来，刷新后还在。

### 2026-10-19：加云端同步和注册登录（Supabase + Brevo）

**为什么**
- 删图标丢数据之后（见下一条），用户要求“以后绝不能再丢数据”。手动导出导入被否决了，因为要靠人记得去做。

**做了什么**
- Supabase 项目、三张表和 RLS、邮件验证码模板，见上面「云端」。
- App：
  - 底部状态条：未登录 / 上传中 / 网络不好还没上传 / 上传失败会重试 / ✓ 已同步。结束训练后要等云端确认收到，才显示「✓ 已保存到云端」。
  - 登录面板：登录、注册、输验证码、忘记密码。没登录也能照常用。
  - 第一次登录时手机上已有的数据会上传，不会被清空（`loadSync()` 第一次运行时把已有数据标成“没上传”）。
- 用户拍板的决定：
  - 本地优先，云端是正本。
  - 两边冲突时以新的为准，旧的备份。
  - 没登录也能用。
  - 验证码而不是邮件链接。
  - 发信用 Brevo，不买域名。

**验证**
- 测试从 7 条加到 14 条（`tests/sync.test.mjs` 7 条）。新增的每条都把对应代码临时改坏跑过，确认会失败。连跑 8 遍没有随机失败。
- RLS：`supabase/checks/rls.sql` 通过。把其中一条检查故意写反，它会报 FAILED。
- 真实环境（电脑 Chrome + 本地服务器 + 真 Supabase + 测试账号 `ericli6897+showup-test@gmail.com`）：
  - 注册 → 收验证码 → 登录，显示「✓ 已同步」。
  - 练一组 → 结束，显示「✓ 已保存到云端」，数据库里 `user_state` 和 `workouts` 都对。
  - 换个 origin（等于新设备）→ 忘记密码 → 验证码 → 新密码，登录后数据拉回来了。
  - 邮件进收件箱，没进垃圾邮件，发件人显示 Show Up。

**没做 / 待确认**
- **iPhone 实测**：上线后的第一次登录，确认手机上的数据传上了云端；断网再联网。
- **没有“退出登录”**：没需求就没做。如果以后加，要想清楚退出后本地数据怎么处理，以及换另一个账号登录时会不会把上一个人的数据传进新账号。
- **误进训练页马上切走，也会记一条历史**：历史宁可多记，不能少记。历史目前没有界面。
- **两部手机几乎同时上传**：没加“比较后再写”的保护。单用户场景基本碰不到，而且结束的训练都在只追加的历史里。
- **多标签页覆盖**（见下面 2026-10-19 那条）还在。现在 `visibilitychange` 会触发同步，但不会重新读 localStorage。
- 测试账号 `ericli6897+showup-test@gmail.com` 留在 Supabase 里，可以在后台 Authentication → Users 删掉，Agent 不删。

### 2026-10-19：删了主屏幕图标，所有数据丢失（无法恢复）

**经过**
- 推送上面那次修复后，Agent 让用户“把主屏幕上的 App 彻底划掉再重新打开”。本意是在多任务界面把 App 上滑关掉。
- 用户理解成删除图标、再从 Safari 书签重新添加到主屏幕。新图标里是空的。
- Safari 里打开同一个网址也是空的。也没有训练截图可以用来补录。数据无法恢复。

**原因**
- iOS 主屏幕 Web App 的存储和 Safari 隔离，每个图标各有一份（WebKit bug 181849）。数据只在旧图标里，旧图标一删就再也打不开了。
- 新代码没有删数据：这次的改动里没有任何清空存储的代码，自动保存每次也只写一个部位。

**规则**
- 见上面「调试前必须知道的事」：不让用户删图标，不发部署专属网址。
- 让用户在手机上做任何操作前，先想清楚这个操作会不会碰到存储。拿不准就先问。
- 待做：备份功能（导出 / 导入）。在这之前，用户的数据只有手机上这一份。

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
