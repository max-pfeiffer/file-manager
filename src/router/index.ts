import { createRouter, createWebHistory } from "vue-router";

import { useAuthStore } from "@/stores/auth";
import FileManagerPage from "@/pages/FileManagerPage.vue";
import LoginPage from "@/pages/LoginPage.vue";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "file-manager",
      component: FileManagerPage,
    },
    {
      path: "/login",
      name: "login",
      component: LoginPage,
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (auth.requiresLogin && to.name !== "login") {
    return { name: "login" };
  }
  if (!auth.requiresLogin && to.name === "login") {
    return { name: "file-manager" };
  }
});

export default router;
