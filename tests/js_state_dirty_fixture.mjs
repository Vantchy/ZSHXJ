/*
 * Test-only chapter: edits ctx.state without calling setUnsavedChanges().
 * Checks that the app automatically detects JSON state changes and
 * clears the dirty comparison only after a confirmed server save.
 */
export const meta = { id: "ch1", title: "State Dirty Fixture" };

export async function mount(ctx) {
  const actions = [];
  function button(name, action) {
    const item = document.createElement("button");
    item.textContent = name;
    item.addEventListener("click", action);
    actions.push([item, action]);
    ctx.container.append(item);
  }

  button("修改电路", () => {
    ctx.state.circuits ??= {};
    ctx.state.circuits.fixtureCount =
      (ctx.state.circuits.fixtureCount || 0) + 1;
  });
  button("保存电路", () => ctx.saveProgress(ctx.state, "fixture_saved"));
  button("返回小地图", () => ctx.exit());
  button("返回主界面", () => ctx.exitToHome());

  return () => {
    for (const [item, action] of actions) {
      item.removeEventListener("click", action);
    }
  };
}
