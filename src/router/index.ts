import { createRouter, createWebHistory } from "vue-router";

import FileManagerPage from "@/pages/FileManagerPage.vue";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "file-manager",
      component: FileManagerPage,
    },
  ],
});

export default router;
