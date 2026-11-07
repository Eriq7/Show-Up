# Show Up

- 已发帖：小红书 2026-10-27（2026-11-07 在原帖加了更新、换了图）https://www.rednote.com/discovery/item/6ae0c7420000000013033800；X 2026-10-27 https://x.com/qunli1/status/2115142965089960443。改了这个项目，改完问 Eric 要不要发更新。

- 调 bug 或改数据保存逻辑前，先读 `Show_Up_动态交接.md`（状态模型、调试流程、测试方法、踩过的坑、进度）。修完在它的「修复记录」最上面追加一条，过时的内容原地删掉。
- 云端同步和登录用 Supabase（项目 `show-up`），发信用 Brevo。配置、坑和查数据的方法见 `Show_Up_动态交接.md` 的「云端」。
- 测试：`cd tests && npm install && npm test`
- 只用 `main` 一个分支。任何更新（代码、文档都算）提交后都直接推到远程 `origin/main`，不用再问（Eric 2026-11-07 说的：“更新完后都要推到远程，这样才是在云端保留着”）。推到 `main` 会自动部署到 Vercel 生产环境。
