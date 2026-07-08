import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/** Seed a file through the backend API (proxied by the Vite dev server). */
async function seedFile(
  request: APIRequestContext,
  name: string,
  content?: string,
) {
  const create = await request.post("/api/create-file", {
    data: { path: "local://", name },
  });
  expect(create.ok()).toBe(true);
  if (content !== undefined) {
    const save = await request.post("/api/save", {
      data: { path: `local://${name}`, content },
    });
    expect(save.ok()).toBe(true);
  }
}

/**
 * An item tile in the explorer pane (not the tree view or a toast).
 * Tiles carry a data-key of the form "file:local://dir/name" or
 * "dir:local://dir/name", so matching on the trailing "/name" finds the
 * entry regardless of type, view mode and current directory.
 */
const explorerItem = (page: Page, name: string) =>
  page.locator(`.vuefinder__explorer__container [data-key$="/${name}"]`);

const contextMenu = (page: Page) => page.locator(".vuefinder__context-menu");

test.describe("file manager", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".vuefinder__explorer__container")).toBeVisible();
  });

  test("shows files that exist in the files root", async ({
    page,
    request,
  }) => {
    await seedFile(request, "seeded.txt", "hello");
    await page.reload();
    await expect(explorerItem(page, "seeded.txt")).toBeVisible();
  });

  test("creates a folder via the File menu", async ({ page }) => {
    await page.getByText("File", { exact: true }).click();
    await page.getByText("New Folder", { exact: true }).click();
    await page.locator("input:visible").first().fill("my-folder");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(explorerItem(page, "my-folder")).toBeVisible();
  });

  test("creates a file via the File menu", async ({ page }) => {
    await page.getByText("File", { exact: true }).click();
    await page.getByText("New File", { exact: true }).click();
    await page.locator("input:visible").first().fill("created.md");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(explorerItem(page, "created.md")).toBeVisible();
  });

  test("renames a file via the context menu", async ({ page, request }) => {
    await seedFile(request, "rename-me.txt");
    await page.reload();
    await explorerItem(page, "rename-me.txt").click({ button: "right" });
    await contextMenu(page).getByText("Rename", { exact: true }).click();
    const input = page.locator("input:visible").first();
    await input.fill("renamed.txt");
    await page.getByRole("button", { name: "Rename" }).click();
    await expect(explorerItem(page, "renamed.txt")).toBeVisible();
    await expect(explorerItem(page, "rename-me.txt")).not.toBeVisible();
  });

  test("deletes a file via the context menu", async ({ page, request }) => {
    await seedFile(request, "delete-me.txt");
    await page.reload();
    await explorerItem(page, "delete-me.txt").click({ button: "right" });
    await contextMenu(page).getByText("Delete", { exact: true }).click();
    // The delete modal requires an explicit confirmation checkbox.
    await page.locator(".vuefinder__delete-modal__checkbox").check();
    await page.getByRole("button", { name: /^Yes/ }).click();
    await expect(explorerItem(page, "delete-me.txt")).not.toBeVisible();
  });

  test("navigates into a folder by double-click", async ({ page, request }) => {
    const folder = await request.post("/api/create-folder", {
      data: { path: "local://", name: "enter-me" },
    });
    expect(folder.ok()).toBe(true);
    const nested = await request.post("/api/create-file", {
      data: { path: "local://enter-me", name: "nested.txt" },
    });
    expect(nested.ok()).toBe(true);

    await page.reload();
    await explorerItem(page, "enter-me").dblclick();
    await expect(explorerItem(page, "nested.txt")).toBeVisible();
  });

  test("previews text file content", async ({ page, request }) => {
    await seedFile(request, "preview-me.txt", "unique preview content");
    await page.reload();
    await explorerItem(page, "preview-me.txt").dblclick();
    await expect(page.getByText("unique preview content")).toBeVisible();
  });
});
