import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueFinderPlugin } from "vuefinder";

import App from "./App.vue";
import router from "./router";

import "./assets/main.css";

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(VueFinderPlugin);

app.mount("#app");
