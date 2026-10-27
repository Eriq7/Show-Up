# Show Up

- 已发帖：小红书 2026-10-27 https://www.rednote.com/discovery/item/6ae0c7420000000013033800。改了这个项目，改完问 Eric 要不要发更新。

- 调 bug 或改数据保存逻辑前，先读 `DEBUGGING.md`（状态模型、调试流程、测试方法、踩过的坑）。修完在它的「记录」最上面追加一条。
- 云端同步和登录用 Supabase（项目 `show-up`），发信用 Brevo。配置、坑和查数据的方法见 `DEBUGGING.md` 的「云端」。
- 测试：`cd tests && npm install && npm test`
- 推到 `main` 会自动部署到 Vercel 生产环境，推送前先问用户。
