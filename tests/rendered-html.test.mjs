import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("Next output and campus wall shell are present", async () => {
  await access(new URL("../.next/", import.meta.url));
  const [layout, wall] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/wall.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /西安铁一中 - 校园娱乐墙/);
  assert.match(wall, /发表你的想法/);
  assert.match(wall, /服务器正在重启更新/);
  assert.match(wall, /正在申请消息权限，请同意/);
  assert.match(wall, /开启消息通知/);
});
