/* 未开发章节的公共占位内容；具体章节组以后替换自己的入口模块。 */
export async function placeholder(ctx) {
  const heading = document.createElement("h3");
  heading.textContent = "本章关卡待开发";
  ctx.container.append(heading);
  const back = document.createElement("button");
  back.textContent = "返回小地图";
  ctx.container.append(back);
  const status = document.createElement("p");
  ctx.container.append(status);
  back.addEventListener("click", async () => {
    back.disabled = true;
    try {
      await ctx.exit();
    } catch (error) {
      status.textContent = error.message;
      back.disabled = false;
    }
  });
}
